const Docker = require('dockerode');
const docker = new Docker();
async function run() {
  try {
    const oldContainer = docker.getContainer('53936e5a2b3044fe8b5a4669ea3aee4f809f6049f84199d7d66364ad662d0e89');
    const info = await oldContainer.inspect();
    const map = info.Config.Labels.mapName || 'de_dust2';
    const maxplayers = info.Config.Labels.maxPlayers || 16;
    const name = info.Config.Labels.serverName || 'Sunucu';
    const owner_id = info.Config.Labels.owner_id || '';
    const port = parseInt(info.HostConfig.PortBindings['27015/udp'][0].HostPort);
    
    await oldContainer.stop();
    await oldContainer.remove({force:true});
    console.log('Old container removed.');

    const configDir = `/home/ubuntu/server_configs/${port}`;
    
    const container = await docker.createContainer({
      Image: 'xash3d-cs15-server:latest',
      name: `cs15-${port}`,
      Tty: true,
      Cmd: [
        'sh', '-c',
        `cd /opt/xashds && exec ./xash -dedicated -game cstrike +map "${map}" +maxplayers "${maxplayers}" +hostname "${name}" +sv_lan 1 +port 27015 +servercfgfile server.cfg`
      ],
      HostConfig: {
        Binds: [
          '/home/ubuntu/xashds/xashds-linux-i386/xash:/opt/xashds/xash',
          '/home/ubuntu/xashds/xashds-linux-i386/filesystem_stdio.so:/opt/xashds/filesystem_stdio.so',
          '/home/ubuntu/valve:/opt/xashds/valve',
          '/home/ubuntu/cstrike:/opt/xashds/cstrike',
          `${configDir}/server.cfg:/opt/xashds/cstrike/server.cfg`,
          `${configDir}/users.ini:/opt/xashds/cstrike/addons/amxmodx/configs/users.ini`
        ],
        PortBindings: {
          '27015/udp': [{ HostPort: port.toString() }],
          '27015/tcp': [{ HostPort: port.toString() }]
        },
        RestartPolicy: { Name: 'no' }
      },
      Env: [
        `MAP=${map}`,
        `MAXPLAYERS=${maxplayers}`,
        `HOSTNAME=${name}`,
        `PORT=27015`
      ],
      Labels: {
        'cs-web-game': 'true',
        'isOfficial': 'false',
        'owner_id': owner_id,
        'serverName': name,
        'mapName': map,
        'maxPlayers': maxplayers.toString()
      }
    });

    await container.start();
    
    const exec = await container.exec({
      Cmd: ['sh', '-c', `echo 'sv_allowdownload 1\\nsv_downloadurl "https://browsercs.com/cs-assets/"\\nsv_timeout 999\\nmp_timelimit 30\\nmp_roundtime 3\\nmp_freezetime 0\\nmp_startmoney 800\\nmp_consistency 0\\nsv_consistency 0\\nsv_lan 1\\nsys_ticrate 100\\nrcon_password "browsercs"\\n' >> cstrike/server.cfg`],
      AttachStdout: true, AttachStderr: true
    });
    await exec.start();

    console.log('New container started successfully with id:', container.id);
  } catch(e) { console.error(e); }
}
run();
