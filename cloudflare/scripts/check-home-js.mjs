const response = await fetch('http://127.0.0.1:8790/assets/home.js');
if (!response.ok) {
  throw new Error(`Failed to fetch home.js: HTTP ${response.status}`);
}

const code = await response.text();
new Function(code);
console.log('home.js syntax OK');
