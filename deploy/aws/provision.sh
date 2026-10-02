#!/usr/bin/env bash
# Creates (or finds) the key pair, security group, EC2 instance and Elastic IP for quants.
#   deploy/aws/provision.sh [--dns]
# --dns upserts A records for DOMAIN and www.DOMAIN when the domain has a Route 53 hosted zone.
# Env: REGION (us-east-1), NAME (quants), INSTANCE_TYPE (t3.medium), DISK_GB (30), KEY_FILE, DOMAIN (quants.wtf),
#      BACKUP_BUCKET (optional: creates an instance role that can write backups to that bucket).
source "$(dirname "$0")/common.sh"

INSTANCE_TYPE="${INSTANCE_TYPE:-t3.medium}"
DISK_GB="${DISK_GB:-30}"
DOMAIN="${DOMAIN:-quants.wtf}"
DNS=0
[ "${1:-}" = "--dns" ] && DNS=1
export AWS_DEFAULT_REGION="$REGION" AWS_PAGER=""

aws sts get-caller-identity --query Account --output text >/dev/null

my_ip="$(curl -fsS --max-time 10 https://checkip.amazonaws.com | tr -d '[:space:]')"
echo "caller IP: $my_ip"

if ! aws ec2 describe-key-pairs --key-names "$NAME" >/dev/null 2>&1; then
  [ -e "$KEY_FILE" ] && { echo "$KEY_FILE exists but key pair $NAME does not; move the file or set KEY_FILE" >&2; exit 1; }
  mkdir -p "$(dirname "$KEY_FILE")"
  aws ec2 create-key-pair --key-name "$NAME" --key-type ed25519 --query KeyMaterial --output text > "$KEY_FILE"
  chmod 600 "$KEY_FILE"
  echo "created key pair $NAME -> $KEY_FILE"
fi

vpc="$(aws ec2 describe-vpcs --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text)"
sg="$(aws ec2 describe-security-groups --filters Name=group-name,Values="$NAME" Name=vpc-id,Values="$vpc" --query 'SecurityGroups[0].GroupId' --output text)"
if [ "$sg" = "None" ]; then
  sg="$(aws ec2 create-security-group --group-name "$NAME" --description "quants web and ssh" --vpc-id "$vpc" --query GroupId --output text)"
  echo "created security group $sg"
fi
allow() { aws ec2 authorize-security-group-ingress --group-id "$sg" "$@" >/dev/null 2>&1 || true; }
allow --protocol tcp --port 22 --cidr "$my_ip/32"
allow --protocol tcp --port 80 --cidr 0.0.0.0/0
allow --protocol tcp --port 443 --cidr 0.0.0.0/0
allow --protocol udp --port 443 --cidr 0.0.0.0/0

profile_args=()
if [ -n "${BACKUP_BUCKET:-}" ]; then
  role="$NAME-instance"
  if ! aws iam get-role --role-name "$role" >/dev/null 2>&1; then
    aws iam create-role --role-name "$role" --assume-role-policy-document \
      '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
  fi
  aws iam put-role-policy --role-name "$role" --policy-name backups --policy-document \
    "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"s3:PutObject\"],\"Resource\":\"arn:aws:s3:::$BACKUP_BUCKET/*\"}]}"
  if ! aws iam get-instance-profile --instance-profile-name "$role" >/dev/null 2>&1; then
    aws iam create-instance-profile --instance-profile-name "$role" >/dev/null
    aws iam add-role-to-instance-profile --instance-profile-name "$role" --role-name "$role"
    # a new instance profile takes a few seconds before EC2 accepts it
    sleep 15
  fi
  profile_args=(--iam-instance-profile "Name=$role")
fi

instance="$(aws ec2 describe-instances --filters Name=tag:Name,Values="$NAME" Name=instance-state-name,Values=pending,running,stopping,stopped \
  --query 'Reservations[0].Instances[0].InstanceId' --output text)"
if [ "$instance" = "None" ]; then
  ami="$(aws ssm get-parameter --name /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id --query Parameter.Value --output text)"
  instance="$(aws ec2 run-instances --image-id "$ami" --instance-type "$INSTANCE_TYPE" --key-name "$NAME" --security-group-ids "$sg" \
    --block-device-mappings "[{\"DeviceName\":\"/dev/sda1\",\"Ebs\":{\"VolumeSize\":$DISK_GB,\"VolumeType\":\"gp3\",\"DeleteOnTermination\":true}}]" \
    --metadata-options HttpTokens=required,HttpPutResponseHopLimit=2,HttpEndpoint=enabled \
    --user-data "file://$ROOT/deploy/aws/user-data.sh" "${profile_args[@]}" \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$NAME}]" "ResourceType=volume,Tags=[{Key=Name,Value=$NAME}]" \
    --query 'Instances[0].InstanceId' --output text)"
  echo "launched $instance ($INSTANCE_TYPE, $ami)"
else
  echo "found instance $instance"
  if [ "$(aws ec2 describe-instances --instance-ids "$instance" --query 'Reservations[0].Instances[0].State.Name' --output text)" = "stopped" ]; then
    aws ec2 start-instances --instance-ids "$instance" >/dev/null
  fi
  if [ ${#profile_args[@]} -gt 0 ] && [ "$(aws ec2 describe-iam-instance-profile-associations --filters Name=instance-id,Values="$instance" --query 'length(IamInstanceProfileAssociations)' --output text)" = "0" ]; then
    aws ec2 associate-iam-instance-profile --instance-id "$instance" --iam-instance-profile "Name=$NAME-instance" >/dev/null
  fi
fi
timeout 600 aws ec2 wait instance-running --instance-ids "$instance"

alloc="$(aws ec2 describe-addresses --filters Name=tag:Name,Values="$NAME" --query 'Addresses[0].AllocationId' --output text)"
if [ "$alloc" = "None" ]; then
  alloc="$(aws ec2 allocate-address --domain vpc --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=$NAME}]" --query AllocationId --output text)"
fi
aws ec2 associate-address --instance-id "$instance" --allocation-id "$alloc" --allow-reassociation >/dev/null
ip="$(aws ec2 describe-addresses --allocation-ids "$alloc" --query 'Addresses[0].PublicIp' --output text)"
echo "$ip" > "$HOST_FILE"

echo "waiting for first boot to finish (up to 10 minutes)"
ready=0
for _ in $(seq 1 60); do
  if ssh "${ssh_opts[@]}" -o BatchMode=yes "$SSH_USER@$ip" test -f /var/lib/quants-ready 2>/dev/null; then ready=1; break; fi
  sleep 10
done
[ "$ready" = 1 ] || echo "instance is up but first boot has not finished; check /var/log/cloud-init-output.log on it"

zone=""
if aws route53 list-hosted-zones >/dev/null 2>&1; then
  zone="$(aws route53 list-hosted-zones --query "HostedZones[?Name=='$DOMAIN.'].Id | [0]" --output text)"
  [ "$zone" = "None" ] && zone=""
fi
if [ "$DNS" = 1 ]; then
  [ -n "$zone" ] || { echo "no Route 53 hosted zone for $DOMAIN; create the records below at your DNS provider" >&2; }
  if [ -n "$zone" ]; then
    aws route53 change-resource-record-sets --hosted-zone-id "$zone" --change-batch "{\"Changes\":[
      {\"Action\":\"UPSERT\",\"ResourceRecordSet\":{\"Name\":\"$DOMAIN\",\"Type\":\"A\",\"TTL\":300,\"ResourceRecords\":[{\"Value\":\"$ip\"}]}},
      {\"Action\":\"UPSERT\",\"ResourceRecordSet\":{\"Name\":\"www.$DOMAIN\",\"Type\":\"A\",\"TTL\":300,\"ResourceRecords\":[{\"Value\":\"$ip\"}]}}]}" >/dev/null
    echo "upserted A records for $DOMAIN and www.$DOMAIN in Route 53 zone $zone"
  fi
fi

cat <<EOF

instance   $instance
ip         $ip
ssh        ssh -i $KEY_FILE $SSH_USER@$ip

DNS records to create (TTL 300):
  $DOMAIN.      A  $ip
  www.$DOMAIN.  A  $ip
$([ -n "$zone" ] && [ "$DNS" = 0 ] && echo "  $DOMAIN is in Route 53 ($zone); run again with --dns to upsert them.")

Before DNS points here, set SITE_HOST=${ip//./-}.sslip.io and SITE_URL=https://${ip//./-}.sslip.io in .env.production.
EOF
