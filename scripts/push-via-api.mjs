// 通过 GitHub REST API 推送当前工作区（绕过 github.com:443 被阻断的问题）。
// 用法：node scripts/push-via-api.mjs "提交信息"
// 依赖：gh CLI 已登录（用 `gh auth token` 取凭据）

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const OWNER = '666wwc';
const REPO = 'radar';
const BRANCH = 'main';
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;

const message = process.argv[2] ?? 'chore: 通过 API 更新';
const token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();

async function api(path, init = {}) {
  const res = await fetch(API + path, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'radar-pusher',
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

async function main() {
  const files = git(['ls-files']).split('\n').filter(Boolean);
  console.log(`待推送文件 ${files.length} 个`);

  for (let attempt = 1; attempt <= 3; attempt++) {
    const ref = await api(`/git/ref/heads/${BRANCH}`);
    const parentSha = ref.object.sha;
    const parent = await api(`/git/commits/${parentSha}`);
    console.log(`第 ${attempt} 次尝试：远端 HEAD ${parentSha.slice(0, 7)}`);

    // 1) 逐个文件建 blob
    const tree = [];
    for (const path of files) {
      const content = readFileSync(path).toString('base64');
      const blob = await api('/git/blobs', {
        method: 'POST',
        body: JSON.stringify({ content, encoding: 'base64' }),
      });
      tree.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    console.log(`  已创建 ${tree.length} 个 blob`);

    // 2) 建 tree
    const newTree = await api('/git/trees', {
      method: 'POST',
      body: JSON.stringify({ base_tree: parent.tree.sha, tree }),
    });

    // 3) 建 commit
    const commit = await api('/git/commits', {
      method: 'POST',
      body: JSON.stringify({ message, tree: newTree.sha, parents: [parentSha] }),
    });

    // 4) 移动分支引用（非强制，远端若又前进会 422，重试）
    try {
      await api(`/git/refs/heads/${BRANCH}`, {
        method: 'PATCH',
        body: JSON.stringify({ sha: commit.sha, force: false }),
      });
      console.log(`✓ 推送成功 commit=${commit.sha}`);
      console.log(`  本地与远端已分叉（同一份内容），下次网络正常时执行：`);
      console.log(`  git fetch origin && git reset --hard origin/${BRANCH}`);
      return;
    } catch (err) {
      console.warn(`  引用更新失败，重试：${String(err.message).slice(0, 120)}`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw new Error('三次尝试均失败');
}

main().catch((err) => {
  console.error('推送失败：', err.message ?? err);
  process.exit(1);
});
