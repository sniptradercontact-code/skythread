// Bundles src/ into a single playable index.html at the repo root.
const esbuild = require('esbuild');
const fs = require('fs');
esbuild.buildSync({ entryPoints: ['src/main.js'], bundle: true, minify: true, format: 'iife', target: 'es2020', outfile: 'dist/game.js', logLevel: 'warning' });
const html = fs.readFileSync('src/index.html', 'utf8');
const js = fs.readFileSync('dist/game.js', 'utf8').replace(/<\/script/gi, '<\\/script');
fs.writeFileSync('index.html', html.replace('/*__GAME__*/', () => 'setTimeout(function(){' + js + '},60);'));
console.log('built index.html (' + (fs.statSync('index.html').size / 1024 | 0) + ' KB)');
