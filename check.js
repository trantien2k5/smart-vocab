const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Color codes for console output
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

let failed = false;

function printStep(msg) {
  console.log(`${BLUE}⇒${RESET} ${msg}`);
}

function printSuccess(msg) {
  console.log(`${GREEN}✔ ${msg}${RESET}`);
}

function printWarning(msg) {
  console.log(`${YELLOW}⚠ ${msg}${RESET}`);
}

function printError(msg, err) {
  console.log(`${RED}✘ LỖI: ${msg}${RESET}`);
  if (err) {
    console.error(err);
  }
  failed = true;
}

function validateCss(cssContent) {
  const stack = [];
  const lines = cssContent.split('\n');
  let insideParentheses = 0;
  
  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];
    for (let charNum = 0; charNum < line.length; charNum++) {
      const char = line[charNum];
      
      if (char === '{' || char === '(' || char === '[') {
        if (char === '(') insideParentheses++;
        stack.push({ char, line: lineNum + 1, col: charNum + 1 });
      } else if (char === '}' || char === ')' || char === ']') {
        if (char === ')') insideParentheses = Math.max(0, insideParentheses - 1);
        if (stack.length === 0) {
          throw new Error(`Ký tự đóng thừa '${char}' tại dòng ${lineNum + 1}, cột ${charNum + 1}`);
        }
        const open = stack.pop();
        if (
          (char === '}' && open.char !== '{') ||
          (char === ')' && open.char !== '(') ||
          (char === ']' && open.char !== '[')
        ) {
          throw new Error(`Không khớp ký tự: Mở '${open.char}' tại dòng ${open.line} nhưng đóng bằng '${char}' tại dòng ${lineNum + 1}, cột ${charNum + 1}`);
        }
      } else if (char === ';' && insideParentheses > 0) {
        throw new Error(`Phát hiện dấu chấm phẩy ';' không hợp lệ bên trong dấu ngoặc tại dòng ${lineNum + 1}, cột ${charNum + 1}`);
      }
    }
  }
  if (stack.length > 0) {
    const open = stack.pop();
    throw new Error(`Thiếu ký tự đóng cho '${open.char}' tại dòng ${open.line}, cột ${open.col}`);
  }
}

console.log(`${BLUE}=============================================`);
console.log(`   VOCAB SPROUT AUTOMATED SYNTAX & REFERENCE CHECKER`);
console.log(`=============================================${RESET}\n`);

// 1. Verify existence of index.html
printStep('Kiểm tra tệp tin chính index.html...');
const indexPath = path.join(__dirname, 'index.html');
if (!fs.existsSync(indexPath)) {
  printError('Không tìm thấy tệp index.html trong thư mục dự án.');
  process.exit(1);
}
printSuccess('Đã tìm thấy index.html');

// 2. Parse index.html to find linked styles & scripts
printStep('Phân tích index.html để tìm các liên kết tài nguyên...');
const indexContent = fs.readFileSync(indexPath, 'utf-8');

const scriptRegex = /<script\s+src="([^"]+)"/g;
const cssRegex = /<link\s+[^>]*href="([^"]+\.css)"/g;

const scripts = [];
const stylesheets = [];
let match;

while ((match = scriptRegex.exec(indexContent)) !== null) {
  scripts.push(match[1]);
}
while ((match = cssRegex.exec(indexContent)) !== null) {
  stylesheets.push(match[1]);
}

printStep(`Tìm thấy ${stylesheets.length} tệp CSS và ${scripts.length} tệp JS được liên kết.`);

// Check Stylesheets
stylesheets.forEach(cssPath => {
  const fullPath = path.join(__dirname, cssPath);
  if (!fs.existsSync(fullPath)) {
    printError(`Tệp CSS liên kết không tồn tại: ${cssPath}`);
  } else {
    printSuccess(`Liên kết CSS hợp lệ: ${cssPath}`);
    try {
      const cssContent = fs.readFileSync(fullPath, 'utf-8');
      validateCss(cssContent);
      printSuccess(`Kiểm tra cú pháp thành công cho: ${cssPath}`);
    } catch (err) {
      printError(`Lỗi cú pháp trong tệp ${cssPath}:`, err.message);
    }
  }
});

// Check JS files existence and compile them
const jsContents = {};
scripts.forEach(jsPath => {
  const fullPath = path.join(__dirname, jsPath);
  if (!fs.existsSync(fullPath)) {
    printError(`Tệp JS liên kết không tồn tại: ${jsPath}`);
    return;
  }
  
  printSuccess(`Liên kết JS tồn tại: ${jsPath}`);
  
  // Syntax check
  try {
    const code = fs.readFileSync(fullPath, 'utf-8');
    jsContents[jsPath] = code;
    new vm.Script(code, { filename: jsPath });
    printSuccess(`Kiểm tra cú pháp thành công cho: ${jsPath}`);
  } catch (err) {
    printError(`Lỗi cú pháp trong tệp ${jsPath}:`, err.message);
  }
});

if (failed) {
  console.log(`\n${RED}=============================================`);
  console.log(`❌ KIỂM TRA THẤT BẠI: Vui lòng sửa các lỗi trên!`);
  console.log(`=============================================${RESET}`);
  process.exit(1);
}

// 3. Mock window and document context to perform basic runtime dry-run
printStep('Đang chạy thử khởi tạo trong môi trường giả lập (Runtime Dry-run)...');

// Mock DOM elements
const createMockElement = (id = 'mock-id') => ({
  id,
  textContent: '',
  style: {},
  classList: {
    add: () => {},
    remove: () => {},
    toggle: () => {},
    contains: () => false
  },
  addEventListener: () => {},
  value: '',
  dataset: {},
  disabled: false
});

const mockElement = createMockElement();

const sandbox = {
  window: {},
  document: {
    documentElement: { className: '' },
    getElementById: (id) => createMockElement(id),
    querySelector: () => mockElement,
    querySelectorAll: () => [mockElement],
    createElement: () => mockElement
  },
  localStorage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {}
  },
  speechSynthesis: {
    cancel: () => {},
    speak: () => {}
  },
  SpeechSynthesisUtterance: function() {},
  console: {
    log: () => {},
    error: (...args) => printWarning(`Log lỗi từ ứng dụng: ${args.join(' ')}`),
    warn: (...args) => printWarning(`Cảnh báo từ ứng dụng: ${args.join(' ')}`)
  },
  setTimeout: () => {},
  clearTimeout: () => {},
  setInterval: () => {},
  clearInterval: () => {},
  Date: Date,
  Math: Math,
  JSON: JSON,
  Array: Array,
  Object: Object,
  String: String,
  Number: Number,
  Boolean: Boolean,
  RegExp: RegExp,
  Error: Error,
  Set: Set,
  Map: Map
};

sandbox.window = sandbox;

// Execute the scripts in mock global context sequentially
try {
  scripts.forEach(jsPath => {
    if (jsContents[jsPath]) {
      vm.runInNewContext(jsContents[jsPath], sandbox, { filename: jsPath });
    }
  });
  printSuccess('Khởi chạy ứng dụng thử nghiệm thành công (Không có lỗi runtime khi load).');
} catch (err) {
  printError('Lỗi Runtime khi tải và khởi chạy mã JavaScript:', err.stack || err.message);
}

console.log('');
if (failed) {
  console.log(`${RED}=============================================`);
  console.log(`❌ KIỂM TRA THẤT BẠI: Đã phát hiện lỗi!`);
  console.log(`=============================================${RESET}`);
  process.exit(1);
} else {
  console.log(`${GREEN}=============================================`);
  console.log(`🎉 KIỂM TRA THÀNH CÔNG: Mọi thứ hoạt động hoàn hảo!`);
  console.log(`=============================================${RESET}`);
  process.exit(0);
}
