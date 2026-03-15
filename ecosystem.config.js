module.exports = {
    apps: [
        {
            name: 'api',
            script: 'dist/script.js',
            instances: 'max',
            exec_mode: 'cluster',
            node_args: '--max-old-space-size=2048', // Optimized for 4GB VPS with Umami/DB
            max_memory_restart: '2G',
            env: {
                NODE_ENV: 'production'
            },
            error_file: './logs/err.log',
            out_file: './logs/out.log',
            time: true,
        }
    ]
};
