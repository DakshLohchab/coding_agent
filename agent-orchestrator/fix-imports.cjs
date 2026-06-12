const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(file));
    } else {
      if (file.endsWith('.ts') || file.endsWith('.tsx')) {
        results.push(file);
      }
    }
  });
  return results;
}

const files = walk('./src');
for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  let changed = false;
  content = content.replace(/from\s+['"](\.[^'"]+)['"]/g, (match, p1) => {
    if (!p1.endsWith('.js') && !p1.endsWith('.json')) {
      changed = true;
      return `from '${p1}.js'`;
    }
    return match;
  });
  if (changed) {
    fs.writeFileSync(file, content, 'utf8');
  }
}
