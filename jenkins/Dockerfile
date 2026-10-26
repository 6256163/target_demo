FROM jenkins/jenkins:lts-jdk17
USER root

# 流水线通过 docker CLI 编排测试容器，因此这里只安装 CLI（socket 由 compose 挂载）
# 注意：Debian trixie 的 docker.io 包未提供可用的 docker 客户端二进制，
# 故改用官方静态二进制，确保 docker / docker compose 子命令可用
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

ARG DOCKER_VERSION=27.3.1
ARG COMPOSE_VERSION=2.30.3
RUN curl -fsSL "https://download.docker.com/linux/static/stable/aarch64/docker-${DOCKER_VERSION}.tgz" -o /tmp/docker.tgz \
    && tar -xzf /tmp/docker.tgz -C /tmp \
    && install -m 0755 /tmp/docker/docker /usr/local/bin/docker \
    && rm -rf /tmp/docker /tmp/docker.tgz
RUN mkdir -p /usr/local/lib/docker/cli-plugins \
    && curl -fsSL "https://github.com/docker/compose/releases/download/v${COMPOSE_VERSION}/docker-compose-linux-aarch64" -o /usr/local/lib/docker/cli-plugins/docker-compose \
    && chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

# 预装常用插件，避免首次进入还要手动安装
COPY plugins.txt /usr/share/jenkins/ref/plugins.txt
RUN jenkins-plugin-cli --plugin-file /usr/share/jenkins/ref/plugins.txt || true

USER jenkins
