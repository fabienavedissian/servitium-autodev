// PM2 process definitions. The dashboard process is added in M5.
module.exports = {
  apps: [
    {
      name: 'autodev-orchestrator',
      script: 'dist/src/index.js',
      node_args: '--env-file-if-exists=.env',
      autorestart: false, // M0 scaffold runs once and exits; switched on when the scheduler lands.
      max_memory_restart: '512M',
    },
  ],
};
