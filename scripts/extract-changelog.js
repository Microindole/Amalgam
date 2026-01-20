// scripts/extract-changelog.js
import { readFileSync } from 'fs';
import { join } from 'path';

// 获取传入的版本号参数 (例如 "v0.1.2")
const targetVersion = process.argv[2];

if (!targetVersion) {
  console.error("❌ 错误: 未提供版本号参数");
  process.exit(1);
}

// 你的 CHANGELOG 文件路径
const changelogPath = join(process.cwd(), 'docs', 'CHANGELOG.md');

try {
  const content = readFileSync(changelogPath, 'utf-8');
  
  // 生成正则：匹配 "## [v0.1.2]" 或 "## v0.1.2" 开始的内容
  // 直到遇到下一个 "## " 标题或文件结束
  // 解释：
  // ^##\s+\[? ... \]?.*$  -> 匹配标题行 (支持有无方括号)
  // \n([\s\S]*?)          -> 捕获中间的所有内容（非贪婪）
  // (?=^##\s|$)           -> 向前查找，直到遇到下一级标题或结尾
  const versionEscaped = escapeRegExp(targetVersion);
  const regex = new RegExp(`^##\\s+\\[?${versionEscaped}\\]?.*$\\n([\\s\\S]*?)(?=\\n##\\s|$)`, 'm');
  
  const match = content.match(regex);

  if (match && match[1]) {
    // 成功找到：输出提取的内容（去除首尾空行）
    console.log(match[1].trim());
  } else {
    // 没找到：输出默认文案
    console.error(`⚠️ 警告: 在 CHANGELOG.md 中未找到 ${targetVersion} 的记录，使用默认描述。`);
    console.log(`**${targetVersion}**\n\n自动发布的版本。详细更新日志请查看 [CHANGELOG.md](../docs/CHANGELOG.md)。`);
  }

} catch (e) {
  console.error("❌ 读取 CHANGELOG.md 失败:", e.message);
  // 即使读取失败，也输出一个保底文案，防止 CI 挂掉
  console.log(`Release ${targetVersion}`);
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}