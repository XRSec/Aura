const fs = require('fs');
const path = require('path');
const os = require('os');

const IGNORED_DIRS = new Set(['ca', 'deploy', 'dnsapi', 'notify', '.git']);

function resolveHomePath(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') return '';
  if (inputPath.startsWith('~/') || inputPath === '~') {
    return path.join(os.homedir(), inputPath.slice(inputPath === '~' ? 1 : 2));
  }
  return path.resolve(inputPath);
}

function getAcmeSearchDirs() {
  const home = os.homedir();
  const dirs = [];

  const envDir = process.env.ACME_DIR || process.env.ACME_HOME || process.env.LE_CONFIG_HOME;
  if (envDir && fs.existsSync(envDir)) {
    dirs.push(path.resolve(envDir));
  }

  const defaultAcmeDir = path.join(home, '.acme.sh');
  if (fs.existsSync(defaultAcmeDir) && !dirs.includes(defaultAcmeDir)) {
    dirs.push(defaultAcmeDir);
  }

  return dirs;
}

function discoverAcmeCertificates() {
  const acmeDirs = getAcmeSearchDirs();
  const results = [];
  const seenDomains = new Set();

  for (const acmeDir of acmeDirs) {
    try {
      const entries = fs.readdirSync(acmeDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dirName = entry.name;
        if (IGNORED_DIRS.has(dirName) || dirName.startsWith('.')) continue;

        const domainDir = path.join(acmeDir, dirName);
        const cleanDomain = dirName.replace(/_ecc$/, '');

        // Locate cert file: prefer fullchain.cer, then domain.cer, then any .cer/.crt
        let certPath = '';
        const fullchainCandidate = path.join(domainDir, 'fullchain.cer');
        const domainCerCandidate = path.join(domainDir, `${cleanDomain}.cer`);
        const dirCerCandidate = path.join(domainDir, `${dirName}.cer`);

        if (fs.existsSync(fullchainCandidate)) {
          certPath = fullchainCandidate;
        } else if (fs.existsSync(domainCerCandidate)) {
          certPath = domainCerCandidate;
        } else if (fs.existsSync(dirCerCandidate)) {
          certPath = dirCerCandidate;
        } else {
          try {
            const files = fs.readdirSync(domainDir);
            const foundCert = files.find(f => (f.endsWith('.cer') || f.endsWith('.crt') || f.endsWith('.pem')) && f !== 'ca.cer');
            if (foundCert) {
              certPath = path.join(domainDir, foundCert);
            }
          } catch {}
        }

        if (!certPath) continue;

        // Locate key file: prefer domain.key, dirName.key, then any .key
        let keyPath = '';
        const domainKeyCandidate = path.join(domainDir, `${cleanDomain}.key`);
        const dirKeyCandidate = path.join(domainDir, `${dirName}.key`);

        if (fs.existsSync(domainKeyCandidate)) {
          keyPath = domainKeyCandidate;
        } else if (fs.existsSync(dirKeyCandidate)) {
          keyPath = dirKeyCandidate;
        } else {
          try {
            const files = fs.readdirSync(domainDir);
            const foundKey = files.find(f => f.endsWith('.key') && !f.endsWith('.csr'));
            if (foundKey) {
              keyPath = path.join(domainDir, foundKey);
            }
          } catch {}
        }

        const isEcc = dirName.endsWith('_ecc');
        const keyId = `${cleanDomain}:${isEcc ? 'ecc' : 'rsa'}`;
        if (!seenDomains.has(keyId)) {
          seenDomains.add(keyId);
          results.push({
            domain: cleanDomain,
            dirName,
            certPath,
            keyPath: keyPath || '',
            isEcc,
            source: '~/.acme.sh'
          });
        }
      }
    } catch (err) {
      console.error(`Failed to scan acme directory ${acmeDir}:`, err);
    }
  }

  return results;
}

function validateSslFiles(certPath, keyPath) {
  const resolvedCert = resolveHomePath(certPath);
  const resolvedKey = resolveHomePath(keyPath);

  if (!resolvedCert || !fs.existsSync(resolvedCert)) {
    return { valid: false, error: 'SSL Certificate file does not exist' };
  }
  if (!resolvedKey || !fs.existsSync(resolvedKey)) {
    return { valid: false, error: 'SSL Private Key file does not exist' };
  }

  try {
    const certContent = fs.readFileSync(resolvedCert, 'utf8');
    const keyContent = fs.readFileSync(resolvedKey, 'utf8');

    if (!certContent.includes('CERTIFICATE')) {
      return { valid: false, error: 'SSL Certificate file is missing standard header (CERTIFICATE)' };
    }
    if (!keyContent.includes('PRIVATE KEY') && !keyContent.includes('KEY')) {
      return { valid: false, error: 'SSL Private Key file is missing standard header (PRIVATE KEY)' };
    }

    return { valid: true, certContent, keyContent };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

module.exports = {
  discoverAcmeCertificates,
  validateSslFiles,
  resolveHomePath
};
