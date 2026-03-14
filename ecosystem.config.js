module.exports = {
    apps: [{
        name: 'api',
        script: 'dist/script.js',
        instances: 1,               // Change from 2 → 1 (you're on 4GB VPS)
        exec_mode: 'fork',          // fork mode uses less overhead than cluster
        node_args: '--max-old-space-size=400 --optimize-for-size --max-semi-space-size=2',
        max_memory_restart: '380M', // Auto-restart before OOM crash
        env: {
            NODE_ENV: 'production'
        },
        error_file: './logs/err.log',
        out_file: './logs/out.log',
        time: true,
    }]
};
