module.exports = {
    apps: [{
        name: 'api',
        script: 'dist/script.js',
        instances: 'max',           // Use all available CPU cores
        exec_mode: 'cluster',       // Parallelize load
        node_args: '--max-old-space-size=3072', // Use up to 3GB of RAM
        max_memory_restart: '3G',   // Auto-restart at 3GB
        env: {
            NODE_ENV: 'production'
        },
        error_file: './logs/err.log',
        out_file: './logs/out.log',
        time: true,
    }]
};
