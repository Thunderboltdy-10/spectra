const http = require('http');

function fetch(path) {
  return new Promise((resolve) => {
    http.get('http://localhost:3000' + path, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ path, status: res.statusCode, data }));
    }).on('error', (e) => resolve({ path, error: e.message }));
  });
}

(async () => {
  const paths = [
    '/api/school-admin/dashboard',
    '/api/school-admin/members',
    '/api/admin/users',
    '/api/school-admin/analytics?days=30',
    '/api/analytics/model-leaderboard',
    '/api/agents'
  ];
  for (const path of paths) {
    const result = await fetch(path);
    console.log(`${result.path}: ${result.status} ${result.data}`);
  }
})();
