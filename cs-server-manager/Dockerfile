FROM ubuntu:20.04

ENV DEBIAN_FRONTEND=noninteractive

RUN dpkg --add-architecture i386 && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
    libc6:i386 libncurses5:i386 libstdc++6:i386 curl wget unzip zip ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Burada xash3d-fwgs (hlds uyumlu) linux sürümü ve cstrike modülünü indireceğiz.
# Ancak şimdilik bu sadece bir iskelettir. Gerçek dosyaların kopyalanması gerekir.
WORKDIR /opt/xash3d

# CS 1.5 dosyalarınızı bu dizine kopyalayın
# COPY ./valve /opt/xash3d/valve
# COPY ./cstrike /opt/xash3d/cstrike
# COPY ./xash3d /opt/xash3d/xash3d

# Start script
RUN echo '#!/bin/bash\n\
./xash3d -dedicated +map $MAP +maxplayers $MAXPLAYERS +hostname "$HOSTNAME" +port $PORT\n\
' > /opt/xash3d/start.sh && chmod +x /opt/xash3d/start.sh

CMD ["/opt/xash3d/start.sh"]
