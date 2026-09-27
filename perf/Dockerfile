FROM eclipse-temurin:17-jre-jammy

ENV JMETER_VERSION=5.6.3
ENV JMETER_HOME=/opt/jmeter
ENV PATH=$JMETER_HOME/bin:$PATH

# 容器内默认 locale 为 POSIX 会让 JDK 17 的 file.encoding 退化成 ASCII，
# 导致中文 CSV（关键字列）与中文响应解析乱码。这里强制 UTF-8。
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8
ENV JVM_ARGS="-Dfile.encoding=UTF-8 -Dsun.jnu.encoding=UTF-8"

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl unzip ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && curl -sSL -o /tmp/jmeter.tgz \
       https://archive.apache.org/dist/jmeter/binaries/apache-jmeter-${JMETER_VERSION}.tgz \
    && mkdir -p /opt \
    && tar -xzf /tmp/jmeter.tgz -C /opt \
    && mv /opt/apache-jmeter-${JMETER_VERSION} ${JMETER_HOME} \
    && rm /tmp/jmeter.tgz

# 说明：JMeter 5.x 自带 InfluxDB Backend Listener（org.apache.jmeter.visualizers.backend.influxdb.*），
#      无需额外插件即可把压测数据实时写入 InfluxDB2 + Grafana。

WORKDIR /jmeter
COPY . /jmeter

ENTRYPOINT ["/opt/jmeter/bin/jmeter"]
