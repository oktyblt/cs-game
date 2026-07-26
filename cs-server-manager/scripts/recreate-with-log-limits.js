#!/usr/bin/env node
/**
 * Recreate all cs15-* containers with json-file log rotation.
 * Prevents root volume fill from Tty console spam.
 */
const Docker = require('dockerode');

const docker = new Docker();

async function main() {
  const list = await docker.listContainers({ all: true });
  const ours = list.filter((c) =>
    (c.Names || []).some((n) => /^\/cs15-\d+$/.test(n))
  );
  console.log(
    'containers:',
    ours.map((c) => c.Names[0]).join(', ') || '(none)'
  );

  for (const summary of ours) {
    const old = docker.getContainer(summary.Id);
    const info = await old.inspect();
    const name = info.Name.replace(/^\//, '');
    const wasRunning = info.State.Running;
    console.log('recreating', name, 'running=', wasRunning);

    const cfg = info.Config;
    const host = info.HostConfig;

    try {
      if (wasRunning) await old.stop({ t: 5 });
    } catch (e) {
      console.warn('stop', name, e.message);
    }
    try {
      await old.remove({ force: true });
    } catch (e) {
      console.warn('remove', name, e.message);
    }

    const created = await docker.createContainer({
      name,
      Image: cfg.Image,
      Tty: cfg.Tty,
      Cmd: cfg.Cmd,
      Env: cfg.Env,
      Labels: cfg.Labels,
      HostConfig: {
        Binds: host.Binds,
        PortBindings: host.PortBindings,
        RestartPolicy: host.RestartPolicy,
        LogConfig: {
          Type: 'json-file',
          Config: { 'max-size': '10m', 'max-file': '2' },
        },
      },
    });

    if (wasRunning) {
      await created.start();
      console.log('started', name);
    } else {
      console.log('created stopped', name);
    }
  }

  console.log('done recreate');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
