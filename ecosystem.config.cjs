// PM2 process definitions.
module.exports = {
  apps: [
    {
      name: 'autodev-dashboard',
      script: 'dist/src/dashboard/server.js',
      node_args: '--env-file-if-exists=.env',
      autorestart: true,
      max_memory_restart: '256M',
      env: { DASH_PORT: '8787' },
    },
    {
      name: 'autodev-orchestrator',
      script: 'dist/src/index.js',
      node_args: '--env-file-if-exists=.env',
      autorestart: false, // not a polling loop yet; started deliberately once the first mission is approved
      max_memory_restart: '512M',
    },
  ],
};
