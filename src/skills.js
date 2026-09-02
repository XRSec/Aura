const fs = require('fs');
const path = require('path');
const os = require('os');
const YAML = require('yaml');

const MAX_SKILL_FILE_BYTES = 1024 * 1024;

function expandHome(inputPath) {
  const value = String(inputPath || '').trim();
  if (!value || value === '~') return os.homedir();
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return value;
}

function isWithin(parentPath, childPath) {
  const relative = path.relative(parentPath, childPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function parseFrontmatter(content, fallbackName) {
  const normalized = String(content || '').replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
  let metadata = {};

  if (match) {
    try {
      metadata = YAML.parse(match[1]) || {};
    } catch {
      metadata = {};
    }
  }

  const name = typeof metadata.name === 'string' && metadata.name.trim()
    ? metadata.name.trim()
    : fallbackName;
  const description = typeof metadata.description === 'string'
    ? metadata.description.replace(/\s+/g, ' ').trim()
    : '';

  return { name, description };
}

function directPackageRoots(nodeModulesPath) {
  if (!fs.existsSync(nodeModulesPath)) return [];
  const roots = [];

  for (const entry of fs.readdirSync(nodeModulesPath, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const entryPath = path.join(nodeModulesPath, entry.name);

    if (entry.name.startsWith('@')) {
      for (const scoped of fs.readdirSync(entryPath, { withFileTypes: true })) {
        if (scoped.isDirectory()) roots.push(path.join(entryPath, scoped.name));
      }
    } else {
      roots.push(entryPath);
    }
  }

  return roots;
}

class SkillRegistry {
  constructor(getFsRoot = () => '~/') {
    this.getFsRoot = getFsRoot;
    this.skills = new Map();
  }

  candidateRoots() {
    const candidates = [];
    const add = (skillsRoot, source) => {
      if (!skillsRoot) return;
      const absolute = path.resolve(expandHome(skillsRoot));
      if (fs.existsSync(absolute) && fs.statSync(absolute).isDirectory()) {
        candidates.push({ root: absolute, source });
      }
    };

    const fsRoot = path.resolve(expandHome(this.getFsRoot()));
    add(path.join(fsRoot, '.agents', 'skills'), 'workspace');
    add(path.join(os.homedir(), '.agents', 'skills'), 'user');
    add(path.join(os.homedir(), '.pi', 'agent', 'skills'), 'pi');

    const extensionsRoot = path.join(os.homedir(), '.pi', 'agent', 'extensions');
    if (fs.existsSync(extensionsRoot)) {
      for (const entry of fs.readdirSync(extensionsRoot, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          add(path.join(extensionsRoot, entry.name, 'skills'), `pi-extension:${entry.name}`);
        }
      }
    }

    const piNodeModules = path.join(os.homedir(), '.pi', 'agent', 'npm', 'node_modules');
    for (const packageRoot of directPackageRoots(piNodeModules)) {
      add(path.join(packageRoot, 'skills'), `pi-package:${path.basename(packageRoot)}`);
    }

    const seen = new Set();
    return candidates.filter(({ root }) => {
      let realRoot;
      try {
        realRoot = fs.realpathSync(root);
      } catch {
        return false;
      }
      if (seen.has(realRoot)) return false;
      seen.add(realRoot);
      return true;
    });
  }

  refresh() {
    const skills = new Map();

    for (const { root, source } of this.candidateRoots()) {
      let realRoot;
      try {
        realRoot = fs.realpathSync(root);
      } catch {
        continue;
      }

      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const skillDir = path.join(root, entry.name);
        const skillFile = path.join(skillDir, 'SKILL.md');
        if (!fs.existsSync(skillFile)) continue;

        try {
          const realDir = fs.realpathSync(skillDir);
          const realSkillFile = fs.realpathSync(skillFile);
          if (!isWithin(realRoot, realDir) || !isWithin(realDir, realSkillFile)) continue;

          const content = fs.readFileSync(realSkillFile, 'utf8');
          const metadata = parseFrontmatter(content, entry.name);
          if (!metadata.name || skills.has(metadata.name)) continue;

          skills.set(metadata.name, {
            name: metadata.name,
            description: metadata.description,
            dir: realDir,
            file: realSkillFile,
            source
          });
        } catch {
          // Ignore unreadable or invalid skill directories and continue discovery.
        }
      }
    }

    this.skills = skills;
    return this.list(false);
  }

  list(refresh = true) {
    if (refresh) this.refresh();
    return Array.from(this.skills.values())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(skill => ({ ...skill }));
  }

  catalogText({ refresh = true, maxDescription = 220 } = {}) {
    const skills = this.list(refresh);
    if (!skills.length) return '(No local skills discovered.)';
    return skills.map(skill => {
      const description = skill.description
        ? skill.description.slice(0, maxDescription) + (skill.description.length > maxDescription ? '…' : '')
        : 'No description provided.';
      return `- ${skill.name}: ${description}`;
    }).join('\n');
  }

  read(skillName, relativePath = 'SKILL.md') {
    this.refresh();
    const skill = this.skills.get(String(skillName || '').trim());
    if (!skill) {
      throw new Error(`Unknown skill '${skillName}'. Call list_skills to inspect available skills.`);
    }

    const requestedPath = String(relativePath || 'SKILL.md').trim() || 'SKILL.md';
    if (path.isAbsolute(requestedPath)) {
      throw new Error('Skill file path must be relative to the skill directory.');
    }

    const target = path.resolve(skill.dir, requestedPath);
    if (!isWithin(skill.dir, target)) {
      throw new Error('Access denied: Skill path escapes the skill directory.');
    }
    if (!fs.existsSync(target)) {
      throw new Error(`Skill file not found: ${requestedPath}`);
    }

    const realTarget = fs.realpathSync(target);
    if (!isWithin(skill.dir, realTarget)) {
      throw new Error('Access denied: Skill file resolves outside the skill directory.');
    }

    const stat = fs.statSync(realTarget);
    if (!stat.isFile()) {
      throw new Error(`Skill path is not a file: ${requestedPath}`);
    }
    if (stat.size > MAX_SKILL_FILE_BYTES) {
      throw new Error(`Skill file is too large (${stat.size} bytes; max ${MAX_SKILL_FILE_BYTES}).`);
    }

    return {
      skill,
      requestedPath,
      absolutePath: realTarget,
      bytes: stat.size,
      content: fs.readFileSync(realTarget, 'utf8')
    };
  }
}

module.exports = SkillRegistry;
