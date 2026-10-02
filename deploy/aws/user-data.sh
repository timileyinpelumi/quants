#!/bin/bash
# First boot on Ubuntu 24.04: Docker with the compose plugin, 4 GB swap (next build needs it on a 4 GB instance), /opt/quants.
set -euxo pipefail
export DEBIAN_FRONTEND=noninteractive

if [ ! -f /swapfile ]; then
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo 'vm.swappiness=10' > /etc/sysctl.d/99-swap.conf
  sysctl --system
fi

install -m 0755 -d /etc/apt/keyrings
curl -fsSL --max-time 60 https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin rsync
systemctl enable --now docker
usermod -aG docker ubuntu

install -d -o ubuntu -g ubuntu /opt/quants
touch /var/lib/quants-ready
