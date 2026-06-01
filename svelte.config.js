import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter({
			// Production configuration for Node.js deployment
			out: 'build',
			precompress: true,
			envPrefix: ''
		}),

		// Security headers
		csp: {
			mode: 'auto',
			directives: {
				'default-src': ['self'],
				'script-src': ['self', 'unsafe-inline'],
				'style-src': ['self', 'unsafe-inline'],
				'img-src': ['self', 'data:', 'https:'],
				'font-src': ['self'],
				'connect-src': ['self'],
				'frame-src': ['none'],
				'object-src': ['none'],
				'base-uri': ['self']
			}
		},

		// CSRF protection
		csrf: {
			checkOrigin: true
		},

		// Version for cache busting
		version: {
			name: process.env.npm_package_version || '1.0.0'
		}
	}
};

export default config;
