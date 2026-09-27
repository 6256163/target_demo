FROM jenkins/jenkins:lts-jdk17
USER root

# 流水线通过 docker CLI 编排测试容器，因此这里只安装 CLI（socket 由 compose 挂载）
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates git docker.io \
    && rm -rf /var/lib/apt/lists/*

# 预装常用插件，避免首次进入还要手动安装
COPY plugins.txt /usr/share/jenkins/ref/plugins.txt
RUN jenkins-plugin-cli --plugin-file /usr/share/jenkins/ref/plugins.txt || true

USER jenkins
