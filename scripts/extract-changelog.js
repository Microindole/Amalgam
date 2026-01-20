// scripts/extract-changelog.js
import { readFileSync } from 'fs';
import { join } from 'path';

const targetVersion = process.argv[2];

if (!targetVersion) {
  console.error("❌ 错误: 未提供版本号参数");
  process.exit(1);
}

const changelogPath = join(process.cwd(), 'docs', 'CHANGELOG.md');

try {
  // 1. 读取文件并立即统一换行符为 \n
  // 这样无论是在 Windows (CRLF) 还是 Linux (LF) 下，后续逻辑都一致
  const rawContent = readFileSync(changelogPath, 'utf-8');
  const content = rawContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  
  const versionEscaped = escapeRegExp(targetVersion);
  
  // 2. 使用更宽松的正则查找标题行
  // 解释：
  // ^##\s+        -> 行首有两个#号和空格
  // \[? ... \]?   -> 版本号可能有 [] 包裹，也可能没有
  // .* -> 忽略这一行后面的日期或其他文字
  const headerRegex = new RegExp(`^##\\s+\\[?${versionEscaped}\\]?.*`, 'm');
  
  const match = content.match(headerRegex);

  if (match) {
    // 找到标题所在的起始位置
    const startIndex = match.index + match[0].length;
    
    // 截取从标题结束到文件末尾的内容
    const remainder = content.slice(startIndex);
    
    // 3. 找下一个标题的位置（以此作为结束点）
    // 查找下一个以 "## " 开头的行
    const nextHeaderRegex = /^##\s/m;
    const nextMatch = remainder.match(nextHeaderRegex);
    
    let body = "";
    if (nextMatch) {
      // 如果后面还有版本，就截取到下一个版本之前
      body = remainder.slice(0, nextMatch.index);
    } else {
      // 如果后面没有版本了（这是最老的版本），就取到底
      body = remainder;
    }

    // 4. 清理首尾空白并输出
    console.log(body.trim());
    
  } else {
    // 没找到时的回退策略
    console.error(`⚠️ 警告: 在 CHANGELOG.md 中未找到 ${targetVersion} 的记录。`);
    // 为了方便调试，打印一下文件的前200个字符，看看是不是读错文件了
    console.error(`--- 文件预览 (前200字符) ---\n${content.slice(0, 200)}\n---------------------------`);
    
    console.log(`**${targetVersion}**\n\n自动发布的版本。详细更新日志请查看 [CHANGELOG.md](../docs/CHANGELOG.md)。`);
  }

} catch (e) {
  console.error("❌ 读取 CHANGELOG.md 失败:", e.message);
  console.log(`Release ${targetVersion}`);
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}