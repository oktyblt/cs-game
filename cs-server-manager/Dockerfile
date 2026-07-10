FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN dpkg --add-architecture i386 && apt-get update && apt-get install -y --no-install-recommends     libsdl2-2.0-0:i386 libc6:i386 libgcc-s1:i386 libstdc++6:i386     && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/xashds

RUN echo '#!/bin/bash\ncd /opt/xashds && exec ./xash -dedicated -game cstrike +map "${MAP:-de_dust2}" +maxplayers "${MAXPLAYERS:-16}" +hostname "${HOSTNAME:-CS Browser Server}" +sv_lan 1 +port "${PORT:-27015}"' > /opt/xashds/start.sh && chmod +x /opt/xashds/start.sh

EXPOSE 27015/udp
EXPOSE 27015/tcp

CMD ["/opt/xashds/start.sh"]
