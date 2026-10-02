FROM postgres:18.0
RUN apt-get update && apt-get install -y --no-install-recommends awscli && rm -rf /var/lib/apt/lists/*
COPY backup.sh /usr/local/bin/backup.sh
ENTRYPOINT ["/usr/local/bin/backup.sh"]
CMD ["loop"]
