import fs from 'node:fs/promises';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export interface ExecuteOptions {
  workingDir: string;
  dryRun?: boolean;
}

export interface ExecuteResult {
  filesWritten: string[];
  errors: string[];
}

function extractCodeBlocks(text: string): Array<{ filename: string; content: string }> {
  const blocks: Array<{ filename: string; content: string }> = [];

  // Format 1: ```language:filepath
  const regex = /```(?:\w+)?:([^\n]+)\n([\s\S]*?)```/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    blocks.push({
      filename: match[1]!.trim(),
      content: match[2]!,
    });
  }

  // Format 2: File: path or ## File: path or **File N: path**
  if (blocks.length === 0) {
    const fileRegex = /(?:\*\*)?(?:File\s*\d*|文件):\s*`?([^\n`*]+?)`?\*\*?\s*(?:\(new file\))?\s*\n+```[\w]*\n([\s\S]*?)```/gi;
    while ((match = fileRegex.exec(text)) !== null) {
      blocks.push({
        filename: match[1]!.trim(),
        content: match[2]!,
      });
    }
  }

  return blocks;
}

function validateWorkingDir(dir: string): boolean {
  const forbidden = ['/', '/usr', '/bin', '/etc', '/var', '/System'];
  if (forbidden.includes(dir)) {
    return false;
  }

  if (!path.isAbsolute(dir)) {
    return false;
  }

  return true;
}

export async function executeCodeChanges(
  implementText: string,
  options: ExecuteOptions,
): Promise<ExecuteResult> {
  const filesWritten: string[] = [];
  const errors: string[] = [];

  if (!validateWorkingDir(options.workingDir)) {
    errors.push(`Invalid working directory: ${options.workingDir}`);
    return { filesWritten, errors };
  }

  try {
    await fs.access(options.workingDir);
  } catch {
    errors.push(`Working directory does not exist: ${options.workingDir}`);
    return { filesWritten, errors };
  }

  const codeBlocks = extractCodeBlocks(implementText);

  if (codeBlocks.length === 0) {
    errors.push('No code blocks found in implementation text');
    return { filesWritten, errors };
  }

  for (const block of codeBlocks) {
    const filePath = path.join(options.workingDir, block.filename);

    const resolvedPath = path.resolve(filePath);
    const resolvedWorkingDir = path.resolve(options.workingDir);
    if (!resolvedPath.startsWith(resolvedWorkingDir)) {
      errors.push(`Security: ${block.filename} is outside working directory`);
      continue;
    }

    if (!options.dryRun) {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, block.content, 'utf-8');
    }

    filesWritten.push(block.filename);
  }

  return { filesWritten, errors };
}

export async function runTests(workingDir: string): Promise<{ success: boolean; output: string }> {
  try {
    const { stdout, stderr } = await execAsync('npm test', {
      cwd: workingDir,
      timeout: 120000,
    });
    return { success: true, output: stdout + stderr };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, output: message };
  }
}

export async function gitCommit(
  workingDir: string,
  message: string,
): Promise<{ success: boolean; output: string }> {
  try {
    await execAsync('git add .', { cwd: workingDir });

    const { stdout: status } = await execAsync('git status --porcelain', { cwd: workingDir });
    if (!status.trim()) {
      return { success: true, output: 'No changes to commit' };
    }

    const { stdout } = await execAsync(`git commit -m "${message.replace(/"/g, '\\"')}"`, {
      cwd: workingDir,
    });
    return { success: true, output: stdout };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, output: message };
  }
}
