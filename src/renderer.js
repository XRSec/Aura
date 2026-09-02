const modeLabels = {
  'cloudflare-named': 'Cloudflare Named Tunnel',
  'cloudflare-quick': 'Cloudflare Quick Tunnel',
  'openai': 'OpenAI Secure MCP Tunnel',
  'custom': 'Custom / Bring Your Own Tunnel'
};

const shellPolicyLabels = {
  'unrestricted': 'Unrestricted',
  'allowlist': 'Allowlist only',
  'denylist': 'Denylist enforced'
};

// Listen to Real-time Logs via IPC immediately at top level
const mcpLogs = [];
const httpLogs = [];
const runtimeLogs = [];

window.api.onMcpLog((logEntry) => {
  mcpLogs.push(logEntry);
  if (mcpLogs.length > 500) mcpLogs.shift();
  renderMcpLogItem(logEntry);
  updateMcpMetrics();
});

window.api.onHttpLog((logEntry) => {
  httpLogs.push(logEntry);
  if (httpLogs.length > 500) httpLogs.shift();
  renderHttpLogItem(logEntry);
});

window.api.onRuntimeLog((logEntry) => {
  runtimeLogs.push(logEntry);
  if (runtimeLogs.length > 1000) runtimeLogs.shift();
  appendRuntimeLog(logEntry);
});

function switchMainTab(targetTab) {
  const tabBtnSettings = document.getElementById('tab-btn-settings');
  const tabBtnLogs = document.getElementById('tab-btn-logs');
  const surfaceSettings = document.getElementById('surface-settings');
  const surfaceLogs = document.getElementById('surface-logs');

  if (targetTab === 'settings') {
    if (tabBtnSettings) {
      tabBtnSettings.classList.add('is-active');
      tabBtnSettings.setAttribute('aria-selected', 'true');
    }
    if (tabBtnLogs) {
      tabBtnLogs.classList.remove('is-active');
      tabBtnLogs.setAttribute('aria-selected', 'false');
    }
    if (surfaceSettings) {
      surfaceSettings.classList.add('is-active');
      surfaceSettings.style.display = 'block';
    }
    if (surfaceLogs) {
      surfaceLogs.classList.remove('is-active');
      surfaceLogs.style.display = 'none';
    }
  } else if (targetTab === 'logs') {
    if (tabBtnLogs) {
      tabBtnLogs.classList.add('is-active');
      tabBtnLogs.setAttribute('aria-selected', 'true');
    }
    if (tabBtnSettings) {
      tabBtnSettings.classList.remove('is-active');
      tabBtnSettings.setAttribute('aria-selected', 'false');
    }
    if (surfaceLogs) {
      surfaceLogs.classList.add('is-active');
      surfaceLogs.style.display = 'flex';
    }
    if (surfaceSettings) {
      surfaceSettings.classList.remove('is-active');
      surfaceSettings.style.display = 'none';
    }
  }
}

function switchLogSubtab(targetSubtab) {
  const subtabMcp = document.getElementById('log-subtab-mcp');
  const subtabHttp = document.getElementById('log-subtab-http');
  const subtabRuntime = document.getElementById('log-subtab-runtime');
  const mcpLogView = document.getElementById('mcp-log-view');
  const httpLogView = document.getElementById('http-log-view');
  const runtimeLogView = document.getElementById('runtime-log-view');

  [subtabMcp, subtabHttp, subtabRuntime].filter(Boolean).forEach(btn => btn.classList.remove('is-active'));
  if (mcpLogView) mcpLogView.style.display = 'none';
  if (httpLogView) httpLogView.style.display = 'none';
  if (runtimeLogView) runtimeLogView.style.display = 'none';

  if (targetSubtab === 'mcp') {
    if (subtabMcp) subtabMcp.classList.add('is-active');
    if (mcpLogView) mcpLogView.style.display = 'grid';
  } else if (targetSubtab === 'http') {
    if (subtabHttp) subtabHttp.classList.add('is-active');
    if (httpLogView) httpLogView.style.display = 'block';
  } else if (targetSubtab === 'runtime') {
    if (subtabRuntime) subtabRuntime.classList.add('is-active');
    if (runtimeLogView) runtimeLogView.style.display = 'flex';
  }
}

window.switchMainTab = switchMainTab;
window.switchLogSubtab = switchLogSubtab;

function filterLogs(keyword) {
  const q = String(keyword || '').trim().toLowerCase();
  document.querySelectorAll('.activity-item').forEach(item => {
    item.style.display = !q || item.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
  document.querySelectorAll('.http-log-item').forEach(item => {
    item.style.display = !q || item.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
  document.querySelectorAll('#runtime-log-stream .log-line').forEach(item => {
    item.style.display = !q || item.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}


function getCurrentMode() {
  return document.getElementById('tunnel-mode-display')?.getAttribute('data-value') || 'cloudflare-named';
}

async function restartCurrentServices(mode = getCurrentMode()) {
  try {
    await window.api.restartTunnel(mode);
  } catch (err) {
    console.error('Failed to restart local MCP services:', err);
    flashTransientHint('Saved, but service restart failed', 'tunnel-install-hint');
  }
}

function focusInput(el, isActive) {
  if (!el) return;
  if (isActive) {
    el.classList.add('is-focused');
  } else {
    el.classList.remove('is-focused');
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const logSearch = document.getElementById('log-search-input');
  if (logSearch) {
    logSearch.addEventListener('input', () => filterLogs(logSearch.value));
  }
  // 1. Immediate sync of service state on page load/reload to prevent state desync
  try {
    const isRunning = await window.api.getServiceState();
    updateServiceUI(isRunning);
  } catch (err) {
    console.error('Failed to get initial service state:', err);
    updateServiceUI(false);
  }

  const config = await window.api.getConfig();

  const cfPathInput = document.getElementById('cf-config-path');
  const mcpUrlInput = document.getElementById('mcp-url');
  const listenHostInput = document.getElementById('listen-host');
  const listenPortInput = document.getElementById('listen-port');
  const openaiBinaryInput = document.getElementById('openai-binary-path');
  const openaiTunnelIdInput = document.getElementById('openai-tunnel-id');
  const openaiApiKeyInput = document.getElementById('openai-api-key');
  const networkSaveBtn = document.getElementById('save-network-btn');
  const accessSaveBtn = document.getElementById('save-access-btn');
  const sandboxSaveBtn = document.getElementById('save-sandbox-btn');
  const currentMode = config.tunnelMode || 'cloudflare-named';

  if (config.autoConnect !== undefined) {
    document.getElementById('auto-connect-toggle').checked = !!config.autoConnect;
  } else {
    document.getElementById('auto-connect-toggle').checked = true;
  }

  const debugToggle = document.getElementById('debug-mode-toggle');
  if (debugToggle) {
    debugToggle.checked = !!config.debugMode;
  }

  await populateListenAddresses(config.listenHost);
  await loadProviderFields(currentMode, config);

  if (config.fsRoot) {
    document.getElementById('fs-root').value = config.fsRoot;
  }
  if (config.adminSecret) {
    document.getElementById('admin-pass').placeholder = '••••••••';
  }

  const initialPolicy = config.shellPolicy || 'unrestricted';
  const policyDisplay = document.getElementById('shell-policy-display');
  if (policyDisplay) {
    policyDisplay.value = shellPolicyLabels[initialPolicy] || 'Unrestricted';
    policyDisplay.setAttribute('data-value', initialPolicy);
    policyDisplay.dataset.savedValue = initialPolicy;
  }

  const allow = (config.shellAllowlist || []).join(', ');
  const deny = (config.shellDenylist || []).join(', ');
  document.getElementById('shell-allow').value = allow;
  document.getElementById('shell-deny').value = deny;

  updateShellStatus(initialPolicy);
  refreshTokens();

  networkSaveBtn.disabled = false;
  accessSaveBtn.disabled = false;
  sandboxSaveBtn.disabled = false;
  document.getElementById('tunnel-mode-display').dataset.savedValue = currentMode;

  [cfPathInput, mcpUrlInput, listenHostInput, listenPortInput, openaiBinaryInput, openaiTunnelIdInput, openaiApiKeyInput].filter(Boolean).forEach(input => {
    input.dataset.savedValue = input.value;
  });
  [document.getElementById('fs-root'), document.getElementById('shell-allow'), document.getElementById('shell-deny')]
    .filter(Boolean)
    .forEach(input => {
      input.dataset.savedValue = input.value;
      input.addEventListener('input', () => {
        updateSandboxSaveState();
        const curPolicy = document.getElementById('shell-policy-display')?.getAttribute('data-value') || 'unrestricted';
        updateShellStatus(curPolicy);
      });
      input.addEventListener('focus', () => focusInput(input, true));
      input.addEventListener('blur', () => focusInput(input, false));
    });
  document.getElementById('admin-pass').addEventListener('input', () => {
    accessSaveBtn.disabled = !document.getElementById('admin-pass').value;
    accessSaveBtn.classList.toggle('btn-primary', !accessSaveBtn.disabled);
  });
  [cfPathInput, mcpUrlInput, listenHostInput, listenPortInput, openaiBinaryInput, openaiTunnelIdInput, openaiApiKeyInput].filter(Boolean).forEach(input => {
    input.addEventListener('focus', () => focusInput(input, true));
    input.addEventListener('blur', () => focusInput(input, false));
    input.addEventListener('input', () => {
      updateNetworkSaveState();
      if (input === openaiTunnelIdInput) {
        renderConnectionGuide(getCurrentMode(), document.getElementById('mcp-url')?.value);
      }
    });
    input.addEventListener('change', updateNetworkSaveState);
  });

  const openaiApiKeyToggleBtn = document.getElementById('openai-api-key-toggle-btn');
  if (openaiApiKeyToggleBtn && openaiApiKeyInput) {
    openaiApiKeyToggleBtn.addEventListener('click', () => {
      const isPassword = openaiApiKeyInput.type === 'password';
      openaiApiKeyInput.type = isPassword ? 'text' : 'password';
      openaiApiKeyToggleBtn.textContent = isPassword ? 'Hide' : 'Show';
    });
  }

  const openaiBrowseBtn = document.getElementById('openai-binary-browse-btn');
  if (openaiBrowseBtn && openaiBinaryInput) {
    openaiBrowseBtn.addEventListener('click', async () => {
      const chosen = await window.api.pickBinaryFile();
      if (chosen) {
        openaiBinaryInput.value = chosen;
        updateNetworkSaveState();
      }
    });
  }

  const customCertInput = document.getElementById('custom-ssl-cert-path');
  const customKeyInput = document.getElementById('custom-ssl-key-path');
  const customCertBrowseBtn = document.getElementById('custom-ssl-cert-browse-btn');
  const customKeyBrowseBtn = document.getElementById('custom-ssl-key-browse-btn');

  if (customCertBrowseBtn && customCertInput) {
    customCertBrowseBtn.addEventListener('click', async () => {
      const chosen = await window.api.pickCertFile();
      if (chosen) {
        customCertInput.value = chosen;
        updateNetworkSaveState();
      }
    });
  }

  if (customKeyBrowseBtn && customKeyInput) {
    customKeyBrowseBtn.addEventListener('click', async () => {
      const chosen = await window.api.pickKeyFile();
      if (chosen) {
        customKeyInput.value = chosen;
        updateNetworkSaveState();
      }
    });
  }

  [customCertInput, customKeyInput].filter(Boolean).forEach(input => {
    input.addEventListener('focus', () => focusInput(input, true));
    input.addEventListener('blur', () => focusInput(input, false));
    input.addEventListener('input', updateNetworkSaveState);
    input.addEventListener('change', updateNetworkSaveState);
  });

  updateNetworkSaveState();
  updateSandboxSaveState();
  await loadInitialLogs();
});

async function loadInitialLogs() {
  try {
    const data = await window.api.getRecentLogs();
    if (data && Array.isArray(data.runtimeLogs) && data.runtimeLogs.length > 0) {
      const stream = document.getElementById('runtime-log-stream');
      if (stream) stream.replaceChildren();
      data.runtimeLogs.forEach(entry => {
        runtimeLogs.push(entry);
        appendRuntimeLog(entry);
      });
    }
    if (data && Array.isArray(data.httpLogs) && data.httpLogs.length > 0) {
      data.httpLogs.forEach(entry => {
        httpLogs.push(entry);
        renderHttpLogItem(entry);
      });
    }
    if (data && Array.isArray(data.mcpLogs) && data.mcpLogs.length > 0) {
      data.mcpLogs.forEach(entry => {
        mcpLogs.push(entry);
        renderMcpLogItem(entry);
      });
      updateMcpMetrics();
    }
  } catch (err) {
    console.error('Failed to load initial logs:', err);
  }
}

function updateSandboxSaveState() {
  const saveBtn = document.getElementById('save-sandbox-btn');
  const policyInput = document.getElementById('shell-policy-display');
  const fsInput = document.getElementById('fs-root');
  const allowInput = document.getElementById('shell-allow');
  const denyInput = document.getElementById('shell-deny');
  if (!saveBtn || !policyInput || !fsInput || !allowInput || !denyInput) return;

  const dirty = (policyInput.getAttribute('data-value') ?? '') !== (policyInput.dataset.savedValue ?? '')
    || fsInput.value.trim() !== (fsInput.dataset.savedValue ?? '').trim()
    || allowInput.value.trim() !== (allowInput.dataset.savedValue ?? '').trim()
    || denyInput.value.trim() !== (denyInput.dataset.savedValue ?? '').trim();

  saveBtn.classList.toggle('btn-primary', dirty);
}

function updateNetworkSaveState() {
  const saveBtn = document.getElementById('save-network-btn');
  const modeInput = document.getElementById('tunnel-mode-display');
  if (!saveBtn || !modeInput) return;

  const currentMode = modeInput.getAttribute('data-value') || modeInput.dataset.value || getCurrentMode();
  const savedMode = modeInput.dataset.savedValue || '';
  const modeDirty = currentMode !== savedMode;

  const activeFields = [
    document.getElementById('listen-host'),
    document.getElementById('listen-port')
  ];

  if (currentMode === 'cloudflare-named') {
    activeFields.push(document.getElementById('cf-config-path'), document.getElementById('mcp-url'));
  } else if (currentMode === 'openai') {
    activeFields.push(
      document.getElementById('openai-binary-path'),
      document.getElementById('openai-tunnel-id'),
      document.getElementById('openai-api-key')
    );
  } else if (currentMode === 'custom') {
    activeFields.push(
      document.getElementById('mcp-url'),
      document.getElementById('custom-ssl-cert-path'),
      document.getElementById('custom-ssl-key-path')
    );
  }

  const fieldsDirty = activeFields.filter(Boolean).some(input => {
    const curVal = String(input.value ?? '').trim();
    const savedVal = String(input.dataset.savedValue ?? '').trim();
    return curVal !== savedVal;
  });

  const dirty = modeDirty || fieldsDirty;
  saveBtn.classList.toggle('btn-primary', dirty);
}

async function populateListenAddresses(selectedAddress = '') {
  const input = document.getElementById('listen-host');
  const arrow = document.getElementById('listen-address-arrow');
  const menu = document.getElementById('listen-address-dropdown-menu');
  if (!input || !arrow || !menu) return;
  try {
    const addresses = await window.api.getListenAddresses();
    menu.replaceChildren();
    addresses.forEach(entry => {
      const option = document.createElement('div');
      option.className = 'combobox-option';
      option.setAttribute('role', 'option');
      option.setAttribute('tabindex', '-1');
      option.setAttribute('aria-selected', 'false');
      option.dataset.value = entry.address;
      option.textContent = `${entry.address} · ${entry.name}`;
      option.addEventListener('click', event => {
        event.stopPropagation();
        input.value = option.textContent;
        input.dataset.value = entry.address;
        setMenuVisibility(menu, input, arrow, false);
        updateNetworkSaveState();
      });
      menu.appendChild(option);
    });
    const selected = addresses.find(entry => entry.address === selectedAddress);
    input.value = selected
      ? `${selected.address} · ${selected.name}`
      : `${selectedAddress || '127.0.0.1'} · Saved address`;
    input.dataset.value = selectedAddress || '127.0.0.1';
    input.dataset.savedValue = input.value;
    arrow.style.display = 'flex';
    arrow.disabled = false;
  } catch (err) {
    console.error('Failed to load listen addresses:', err);
  }
}

async function loadProviderFields(mode, config = null) {
  const providerConfig = config || await window.api.getConfig(mode);
  window.currentMcpPath = providerConfig.mcpPath || '/mcp';
  const cfPathInput = document.getElementById('cf-config-path');
  const mcpUrlInput = document.getElementById('mcp-url');
  const listenHostInput = document.getElementById('listen-host');
  const listenPortInput = document.getElementById('listen-port');
  const openaiBinaryInput = document.getElementById('openai-binary-path');
  const openaiTunnelIdInput = document.getElementById('openai-tunnel-id');
  const openaiApiKeyInput = document.getElementById('openai-api-key');
  const tunnelDisplay = document.getElementById('tunnel-mode-display');

  cfPathInput.value = providerConfig.cfConfigPath || '';
  cfPathInput.dataset.savedValue = cfPathInput.value;
  mcpUrlInput.value = providerConfig.mcpUrl || '';
  mcpUrlInput.dataset.savedValue = mcpUrlInput.value;
  listenHostInput.value = providerConfig.listenHost || '127.0.0.1';
  listenHostInput.dataset.savedValue = listenHostInput.value;
  listenPortInput.value = providerConfig.listenPort || 3000;
  listenPortInput.dataset.savedValue = String(listenPortInput.value);

  if (openaiBinaryInput) {
    openaiBinaryInput.value = providerConfig.binaryPath || '';
    openaiBinaryInput.dataset.savedValue = openaiBinaryInput.value;
  }
  if (openaiTunnelIdInput) {
    openaiTunnelIdInput.value = providerConfig.tunnelId || '';
    openaiTunnelIdInput.dataset.savedValue = openaiTunnelIdInput.value;
  }
  if (openaiApiKeyInput) {
    openaiApiKeyInput.value = providerConfig.tunnelApiKey || '';
    openaiApiKeyInput.dataset.savedValue = openaiApiKeyInput.value;
  }

  const customSslCertInput = document.getElementById('custom-ssl-cert-path');
  const customSslKeyInput = document.getElementById('custom-ssl-key-path');
  if (customSslCertInput) {
    customSslCertInput.value = providerConfig.sslCertPath || '';
    customSslCertInput.dataset.savedValue = customSslCertInput.value;
  }
  if (customSslKeyInput) {
    customSslKeyInput.value = providerConfig.sslKeyPath || '';
    customSslKeyInput.dataset.savedValue = customSslKeyInput.value;
  }

  tunnelDisplay.value = modeLabels[mode] || mode;
  tunnelDisplay.setAttribute('data-value', mode);
  tunnelDisplay.dataset.value = mode;
  await populateListenAddresses(providerConfig.listenHost);
  await updateTunnelModeFields(mode);
}

function updateServiceUI(isRunning) {
  const badge = document.getElementById('status-indicator');
  const text = document.getElementById('status-text');
  const btn = document.getElementById('power-btn');
  if (!badge || !text || !btn) return;

  if (isRunning) {
    badge.className = 'status-badge';
    text.textContent = 'Running';
    btn.textContent = 'Disconnect';
    btn.className = 'btn btn-danger';
    btn.style.color = '';
    btn.style.border = '';
  } else {
    badge.className = 'status-badge is-stopped';
    text.textContent = 'Stopped';
    btn.textContent = 'Connect';
    btn.className = 'btn btn-secondary';
    btn.style.color = 'var(--green-300)';
    btn.style.border = '1px solid rgb(64 201 119 / 26%)';
  }
}

document.getElementById('power-btn').addEventListener('click', async () => {
  const isCurrentlyRunning = await window.api.getServiceState();
  const newState = await window.api.toggleServiceState(!isCurrentlyRunning);
  updateServiceUI(newState);
});

window.api.onServiceStateChanged((isRunning) => {
  updateServiceUI(isRunning);
});

document.getElementById('auto-connect-toggle').addEventListener('change', async (e) => {
  await window.api.saveConfig({ autoConnect: e.target.checked });
});

const debugModeToggle = document.getElementById('debug-mode-toggle');
if (debugModeToggle) {
  debugModeToggle.addEventListener('change', async (e) => {
    await window.api.saveConfig({ debugMode: e.target.checked });
    flashTransientHint(`Debug mode ${e.target.checked ? 'enabled (verbose logging)' : 'disabled'}`, 'tunnel-install-hint');
  });
}

async function refreshTokens() {
  const tokens = await window.api.getTokens();
  const listEl = document.getElementById('tokens-list');
  listEl.replaceChildren();

  if (tokens.length === 0) {
    const emptyNotice = document.createElement('div');
    emptyNotice.className = 'token-empty-state';

    const emptyTitle = document.createElement('strong');
    emptyTitle.textContent = 'No active tokens';

    const emptyDetail = document.createElement('span');
    emptyDetail.textContent = 'Tokens will appear here after an MCP client completes authorization.';

    emptyNotice.appendChild(emptyTitle);
    emptyNotice.appendChild(emptyDetail);
    listEl.appendChild(emptyNotice);
    return;
  }

  tokens.forEach(t => {
    const div = document.createElement('div');
    div.className = 'token-item';

    const time = new Date(t.issuedAt).toLocaleTimeString();
    const infoContainer = document.createElement('div');
    infoContainer.style.minWidth = '0';
    infoContainer.style.overflow = 'hidden';
    infoContainer.style.textOverflow = 'ellipsis';
    infoContainer.style.paddingRight = '8px';

    const clientIdEl = document.createElement('div');
    clientIdEl.style.color = 'var(--color-text-primary)';
    clientIdEl.style.fontWeight = '500';
    clientIdEl.textContent = t.client_id;

    const metaEl = document.createElement('div');
    metaEl.className = 'token-meta';

    const durationText = t.duration || 'unknown';
    const durationBadge = document.createElement('span');
    durationBadge.className = 'token-badge is-duration';
    durationBadge.textContent = durationText;

    const validBadge = document.createElement('span');
    validBadge.className = 'token-badge is-valid';
    validBadge.textContent = 'Active';

    metaEl.appendChild(durationBadge);
    metaEl.appendChild(validBadge);

    const issuedEl = document.createElement('div');
    issuedEl.style.color = 'var(--color-text-tertiary)';
    issuedEl.style.fontSize = '10px';
    issuedEl.textContent = `Issued ${time}`;

    infoContainer.appendChild(clientIdEl);
    infoContainer.appendChild(issuedEl);
    infoContainer.appendChild(metaEl);

    const revokeBtn = document.createElement('button');
    revokeBtn.className = 'btn btn-danger';
    revokeBtn.textContent = 'Revoke';
    revokeBtn.addEventListener('click', async () => {
      const originalText = revokeBtn.textContent;
      revokeBtn.disabled = true;
      revokeBtn.classList.add('is-loading');
      revokeBtn.textContent = 'Revoking';
      try {
        await window.api.revokeToken(t.token);
        flashTransientHint('Token revoked', 'tunnel-install-hint');
        await refreshTokens();
      } catch (err) {
        console.error('Failed to revoke token:', err);
        flashTransientHint('Failed to revoke token', 'tunnel-install-hint');
        revokeBtn.textContent = originalText;
        revokeBtn.disabled = false;
        revokeBtn.classList.remove('is-loading');
      }
    });

    div.appendChild(infoContainer);
    div.appendChild(revokeBtn);
    listEl.appendChild(div);
  });
}

document.getElementById('refresh-tokens-btn').addEventListener('click', async () => {
  const btn = document.getElementById('refresh-tokens-btn');
  btn.classList.add('is-loading');
  try {
    await refreshTokens();
  } finally {
    btn.classList.remove('is-loading');
  }
});

function updateShellStatus(policy) {
  const statusEl = document.getElementById('shell-status');
  if (!statusEl) return;
  if (policy === 'unrestricted') {
    statusEl.textContent = 'Status: Unrestricted (All commands allowed)';
    statusEl.style.color = 'var(--orange-300)';
  } else if (policy === 'allowlist') {
    statusEl.textContent = 'Status: Allowlist only (Only allowed commands permitted)';
    statusEl.style.color = 'var(--green-300)';
  } else if (policy === 'denylist') {
    statusEl.textContent = 'Status: Denylist enforced (Blocked commands will be rejected)';
    statusEl.style.color = 'var(--green-300)';
  }
}

function flashSaveFeedback(btn, successText = 'Saved ✓') {
  if (!btn) return;
  btn.textContent = successText;
  btn.classList.remove('is-loading');
  btn.classList.add('btn-success');
  setTimeout(() => {
    if (btn.textContent === successText) {
      btn.textContent = 'Save';
    }
    btn.classList.remove('btn-success');
  }, 1400);
}

function flashTransientHint(text, elId) {
  const hintEl = document.getElementById(elId);
  if (!hintEl) return;
  const previous = hintEl.textContent;
  hintEl.textContent = text;
  setTimeout(() => {
    if (hintEl.textContent === text) {
      hintEl.textContent = previous;
    }
  }, 1100);
}

document.getElementById('tunnel-doc-link').addEventListener('click', (e) => {
  e.preventDefault();
  const mode = document.getElementById('tunnel-mode-display').getAttribute('data-value') || 'cloudflare-named';
  if (mode === 'openai') {
    window.api.openExternal('https://github.com/openai/tunnel-client');
  } else {
    window.api.openExternal('https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/');
  }
});

// Accessible custom dropdowns for Tunnel Mode, hostname, and config file.
const tunnelMenu = document.getElementById('tunnel-mode-dropdown-menu');
const tunnelArrowBtn = document.getElementById('tunnel-mode-arrow');
const tunnelDisplay = document.getElementById('tunnel-mode-display');
const dropdownMenu = document.getElementById('cf-dropdown-menu');
const arrowBtn = document.getElementById('cf-hostname-arrow');
const configDropdownMenu = document.getElementById('cf-config-dropdown-menu');
const configArrowBtn = document.getElementById('cf-config-arrow');
const configInput = document.getElementById('cf-config-path');
const openaiBinaryMenu = document.getElementById('openai-binary-dropdown-menu');
const openaiBinaryArrowBtn = document.getElementById('openai-binary-arrow');
const openaiBinaryInput = document.getElementById('openai-binary-path');
const customSslCertMenu = document.getElementById('custom-ssl-cert-dropdown-menu');
const customSslCertArrowBtn = document.getElementById('custom-ssl-cert-arrow');
const customSslCertInput = document.getElementById('custom-ssl-cert-path');

function setMenuVisibility(menu, input, arrow, isVisible) {
  if (!menu || !input || !arrow) return;
  menu.style.display = isVisible ? 'block' : 'none';
  input.setAttribute('aria-expanded', String(isVisible));
  arrow.setAttribute('aria-expanded', String(isVisible));
  menu.setAttribute('aria-hidden', String(!isVisible));
  if (!isVisible) {
    menu.querySelectorAll('[role="option"]').forEach(option => {
      option.classList.remove('is-active');
      option.setAttribute('aria-selected', 'false');
    });
    delete menu.dataset.activeIndex;
  }
}

function closeDropdowns(except = null) {
  const listenAddressMenu = document.getElementById('listen-address-dropdown-menu');
  const listenAddressInput = document.getElementById('listen-host');
  const listenAddressArrow = document.getElementById('listen-address-arrow');
  const shellPolicyMenu = document.getElementById('shell-policy-dropdown-menu');
  const shellPolicyDisplay = document.getElementById('shell-policy-display');
  const shellPolicyArrowBtn = document.getElementById('shell-policy-arrow');
  if (except !== tunnelMenu) setMenuVisibility(tunnelMenu, tunnelDisplay, tunnelArrowBtn, false);
  if (except !== dropdownMenu) setMenuVisibility(dropdownMenu, document.getElementById('mcp-url'), arrowBtn, false);
  if (except !== configDropdownMenu) setMenuVisibility(configDropdownMenu, configInput, configArrowBtn, false);
  if (except !== openaiBinaryMenu) setMenuVisibility(openaiBinaryMenu, openaiBinaryInput, openaiBinaryArrowBtn, false);
  if (except !== customSslCertMenu) setMenuVisibility(customSslCertMenu, customSslCertInput, customSslCertArrowBtn, false);
  if (listenAddressMenu && listenAddressInput && listenAddressArrow && except !== listenAddressMenu) {
    setMenuVisibility(listenAddressMenu, listenAddressInput, listenAddressArrow, false);
  }
  if (shellPolicyMenu && shellPolicyDisplay && shellPolicyArrowBtn && except !== shellPolicyMenu) {
    setMenuVisibility(shellPolicyMenu, shellPolicyDisplay, shellPolicyArrowBtn, false);
  }
}

function setActiveOption(menu, index) {
  const options = Array.from(menu.querySelectorAll('[role="option"]'));
  if (!options.length) return;
  const nextIndex = (index + options.length) % options.length;
  options.forEach((option, optionIndex) => {
    const active = optionIndex === nextIndex;
    option.classList.toggle('is-active', active);
    option.setAttribute('aria-selected', String(active));
  });
  menu.dataset.activeIndex = String(nextIndex);
}

function handleComboboxKeydown(event, menu, input, arrow) {
  const options = Array.from(menu.querySelectorAll('[role="option"]'));
  const isArrowTrigger = event.currentTarget === arrow;
  const isEditableInput = !input.readOnly;
  if (isArrowTrigger && (event.key === 'Enter' || event.key === ' ')) return;
  if (isEditableInput && !isArrowTrigger && (event.key === 'Enter' || event.key === ' ')) return;
  if (event.key === 'Escape') {
    if (menu.style.display === 'block') {
      event.preventDefault();
      setMenuVisibility(menu, input, arrow, false);
      input.focus();
    }
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) return;

  if (event.key === 'Enter' || event.key === ' ') {
    if (menu.style.display !== 'block') {
      event.preventDefault();
      if (options.length) {
        setMenuVisibility(menu, input, arrow, true);
        setActiveOption(menu, 0);
      }
      return;
    }
    const activeIndex = Number(menu.dataset.activeIndex);
    if (Number.isInteger(activeIndex) && options[activeIndex]) {
      event.preventDefault();
      options[activeIndex].click();
    }
    return;
  }

  if (!options.length) return;
  event.preventDefault();
  if (menu.style.display !== 'block') {
    closeDropdowns(menu);
    setMenuVisibility(menu, input, arrow, true);
  }
  const currentIndex = Number(menu.dataset.activeIndex);
  const index = Number.isInteger(currentIndex) ? currentIndex : 0;
  if (event.key === 'ArrowDown') setActiveOption(menu, index + 1);
  if (event.key === 'ArrowUp') setActiveOption(menu, index - 1);
  if (event.key === 'Home') setActiveOption(menu, 0);
  if (event.key === 'End') setActiveOption(menu, options.length - 1);
}

function toggleTunnelMenu() {
  const isVisible = tunnelMenu.style.display === 'block';
  closeDropdowns(isVisible ? null : tunnelMenu);
  setMenuVisibility(tunnelMenu, tunnelDisplay, tunnelArrowBtn, !isVisible);
  if (!isVisible) setActiveOption(tunnelMenu, 0);
}

function toggleHostnameMenu() {
  const input = document.getElementById('mcp-url');
  const isVisible = dropdownMenu.style.display === 'block';
  closeDropdowns(isVisible ? null : dropdownMenu);
  setMenuVisibility(dropdownMenu, input, arrowBtn, !isVisible);
  if (!isVisible) setActiveOption(dropdownMenu, 0);
}

function toggleConfigMenu() {
  const isVisible = configDropdownMenu.style.display === 'block';
  closeDropdowns(isVisible ? null : configDropdownMenu);
  setMenuVisibility(configDropdownMenu, configInput, configArrowBtn, !isVisible);
  if (!isVisible) setActiveOption(configDropdownMenu, 0);
}

function toggleOpenaiBinaryMenu() {
  if (!openaiBinaryMenu || !openaiBinaryInput || !openaiBinaryArrowBtn) return;
  const isVisible = openaiBinaryMenu.style.display === 'block';
  closeDropdowns(isVisible ? null : openaiBinaryMenu);
  setMenuVisibility(openaiBinaryMenu, openaiBinaryInput, openaiBinaryArrowBtn, !isVisible);
  if (!isVisible) setActiveOption(openaiBinaryMenu, 0);
}

function toggleCustomSslCertMenu() {
  if (!customSslCertMenu || !customSslCertInput || !customSslCertArrowBtn) return;
  const isVisible = customSslCertMenu.style.display === 'block';
  closeDropdowns(isVisible ? null : customSslCertMenu);
  setMenuVisibility(customSslCertMenu, customSslCertInput, customSslCertArrowBtn, !isVisible);
  if (!isVisible) setActiveOption(customSslCertMenu, 0);
}

tunnelArrowBtn.addEventListener('click', toggleTunnelMenu);
tunnelDisplay.addEventListener('click', toggleTunnelMenu);
tunnelDisplay.addEventListener('keydown', event => handleComboboxKeydown(event, tunnelMenu, tunnelDisplay, tunnelArrowBtn));
tunnelArrowBtn.addEventListener('keydown', event => handleComboboxKeydown(event, tunnelMenu, tunnelDisplay, tunnelArrowBtn));

const hostnameInput = document.getElementById('mcp-url');
arrowBtn.addEventListener('click', event => {
  event.stopPropagation();
  toggleHostnameMenu();
});
hostnameInput.addEventListener('keydown', event => handleComboboxKeydown(event, dropdownMenu, hostnameInput, arrowBtn));
arrowBtn.addEventListener('keydown', event => handleComboboxKeydown(event, dropdownMenu, hostnameInput, arrowBtn));

configArrowBtn.addEventListener('click', event => {
  event.stopPropagation();
  toggleConfigMenu();
});
configInput.addEventListener('keydown', event => handleComboboxKeydown(event, configDropdownMenu, configInput, configArrowBtn));
configArrowBtn.addEventListener('keydown', event => handleComboboxKeydown(event, configDropdownMenu, configInput, configArrowBtn));

if (openaiBinaryArrowBtn && openaiBinaryInput && openaiBinaryMenu) {
  openaiBinaryArrowBtn.addEventListener('click', event => {
    event.stopPropagation();
    toggleOpenaiBinaryMenu();
  });
  openaiBinaryInput.addEventListener('keydown', event => handleComboboxKeydown(event, openaiBinaryMenu, openaiBinaryInput, openaiBinaryArrowBtn));
  openaiBinaryArrowBtn.addEventListener('keydown', event => handleComboboxKeydown(event, openaiBinaryMenu, openaiBinaryInput, openaiBinaryArrowBtn));
}

if (customSslCertArrowBtn && customSslCertInput && customSslCertMenu) {
  customSslCertArrowBtn.addEventListener('click', event => {
    event.stopPropagation();
    toggleCustomSslCertMenu();
  });
  customSslCertInput.addEventListener('keydown', event => handleComboboxKeydown(event, customSslCertMenu, customSslCertInput, customSslCertArrowBtn));
  customSslCertArrowBtn.addEventListener('keydown', event => handleComboboxKeydown(event, customSslCertMenu, customSslCertInput, customSslCertArrowBtn));
}

tunnelMenu.querySelectorAll('[role="option"]').forEach(option => {
  option.setAttribute('aria-selected', 'false');
  option.addEventListener('click', async event => {
    event.stopPropagation();
    const mode = option.getAttribute('data-value');
    setMenuVisibility(tunnelMenu, tunnelDisplay, tunnelArrowBtn, false);
    await loadProviderFields(mode);
    updateNetworkSaveState();
  });
});

const shellPolicyMenu = document.getElementById('shell-policy-dropdown-menu');
const shellPolicyArrowBtn = document.getElementById('shell-policy-arrow');
const shellPolicyDisplay = document.getElementById('shell-policy-display');

function toggleShellPolicyMenu() {
  const isVisible = shellPolicyMenu.style.display === 'block';
  closeDropdowns(isVisible ? null : shellPolicyMenu);
  setMenuVisibility(shellPolicyMenu, shellPolicyDisplay, shellPolicyArrowBtn, !isVisible);
  if (!isVisible) setActiveOption(shellPolicyMenu, 0);
}

shellPolicyArrowBtn.addEventListener('click', toggleShellPolicyMenu);
shellPolicyDisplay.addEventListener('click', toggleShellPolicyMenu);
shellPolicyDisplay.addEventListener('keydown', event => handleComboboxKeydown(event, shellPolicyMenu, shellPolicyDisplay, shellPolicyArrowBtn));
shellPolicyArrowBtn.addEventListener('keydown', event => handleComboboxKeydown(event, shellPolicyMenu, shellPolicyDisplay, shellPolicyArrowBtn));

shellPolicyMenu.querySelectorAll('[role="option"]').forEach(option => {
  option.setAttribute('aria-selected', 'false');
  option.addEventListener('click', event => {
    event.stopPropagation();
    const policy = option.getAttribute('data-value');
    shellPolicyDisplay.value = shellPolicyLabels[policy] || policy;
    shellPolicyDisplay.setAttribute('data-value', policy);
    setMenuVisibility(shellPolicyMenu, shellPolicyDisplay, shellPolicyArrowBtn, false);
    updateSandboxSaveState();
    updateShellStatus(policy);
  });
});

setMenuVisibility(tunnelMenu, tunnelDisplay, tunnelArrowBtn, false);
setMenuVisibility(dropdownMenu, hostnameInput, arrowBtn, false);
setMenuVisibility(configDropdownMenu, configInput, configArrowBtn, false);
setMenuVisibility(openaiBinaryMenu, openaiBinaryInput, openaiBinaryArrowBtn, false);
setMenuVisibility(customSslCertMenu, customSslCertInput, customSslCertArrowBtn, false);
setMenuVisibility(shellPolicyMenu, shellPolicyDisplay, shellPolicyArrowBtn, false);

 document.getElementById('clear-log-btn').addEventListener('click', () => {
  const logBox = document.getElementById('activity-log');
  logBox.value = '';
  flashTransientHint('Activity log cleared', 'tunnel-install-hint');
});

async function saveNetworkSettings() {
  const networkSaveBtn = document.getElementById('save-network-btn');
  const modeInput = document.getElementById('tunnel-mode-display');
  const cfPathInput = document.getElementById('cf-config-path');
  const urlInput = document.getElementById('mcp-url');
  const hostInput = document.getElementById('listen-host');
  const portInput = document.getElementById('listen-port');
  const binaryInput = document.getElementById('openai-binary-path');
  const tunnelIdInput = document.getElementById('openai-tunnel-id');
  const apiKeyInput = document.getElementById('openai-api-key');
  const sslCertInput = document.getElementById('custom-ssl-cert-path');
  const sslKeyInput = document.getElementById('custom-ssl-key-path');

  const rawPort = portInput ? String(portInput.value).trim() : '3000';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    flashTransientHint('Enter a valid port between 1 and 65535', 'tunnel-install-hint');
    if (portInput) portInput.focus();
    return;
  }

  if (networkSaveBtn) networkSaveBtn.classList.add('is-loading');
  try {
    const mode = getCurrentMode();
    const configPayload = {
      tunnelMode: mode,
      cfConfigPath: cfPathInput ? cfPathInput.value.trim() : '',
      mcpUrl: urlInput ? urlInput.value.trim() : '',
      listenHost: hostInput ? (hostInput.dataset.value || hostInput.value.split(' · ')[0]) : '127.0.0.1',
      listenPort: port,
      binaryPath: binaryInput ? binaryInput.value.trim() : '',
      tunnelId: tunnelIdInput ? tunnelIdInput.value.trim() : '',
      tunnelApiKey: apiKeyInput ? apiKeyInput.value.trim() : '',
      sslCertPath: sslCertInput ? sslCertInput.value.trim() : '',
      sslKeyPath: sslKeyInput ? sslKeyInput.value.trim() : ''
    };

    await window.api.saveConfig(configPayload);

    // Direct synchronization of saved values without race conditions
    if (cfPathInput) cfPathInput.dataset.savedValue = cfPathInput.value;
    if (urlInput) urlInput.dataset.savedValue = urlInput.value;
    if (hostInput) hostInput.dataset.savedValue = hostInput.value;
    if (portInput) portInput.dataset.savedValue = String(port);
    if (binaryInput) binaryInput.dataset.savedValue = binaryInput.value;
    if (tunnelIdInput) tunnelIdInput.dataset.savedValue = tunnelIdInput.value;
    if (apiKeyInput) apiKeyInput.dataset.savedValue = apiKeyInput.value;
    if (sslCertInput) sslCertInput.dataset.savedValue = sslCertInput.value;
    if (sslKeyInput) sslKeyInput.dataset.savedValue = sslKeyInput.value;

    if (modeInput) {
      modeInput.dataset.savedValue = mode;
      modeInput.dataset.value = mode;
      modeInput.setAttribute('data-value', mode);
    }

    updateNetworkSaveState();
    renderConnectionGuide(mode, urlInput ? urlInput.value : '');
    await restartCurrentServices(mode);
    if (networkSaveBtn) flashSaveFeedback(networkSaveBtn);
  } catch (err) {
    console.error('Failed to save network settings:', err);
    flashTransientHint('Failed to save settings: ' + err.message, 'tunnel-install-hint');
  } finally {
    if (networkSaveBtn) networkSaveBtn.classList.remove('is-loading');
  }
}

window.saveNetworkSettings = saveNetworkSettings;
window.saveAccessSettings = saveAccessSettings;
window.saveSandboxSettings = saveSandboxSettings;

async function saveAccessSettings() {
  const accessSaveBtn = document.getElementById('save-access-btn');
  const input = document.getElementById('admin-pass');
  if (!input || !input.value) {
    flashTransientHint('Enter a password to save', 'tunnel-install-hint');
    if (input) input.focus();
    return;
  }
  if (accessSaveBtn) accessSaveBtn.classList.add('is-loading');
  try {
    if (await window.api.saveSecret(input.value)) {
      input.value = '';
      input.placeholder = '••••••••';
      if (accessSaveBtn) {
        accessSaveBtn.classList.remove('btn-primary');
        flashSaveFeedback(accessSaveBtn);
      }
    }
  } finally {
    if (accessSaveBtn) accessSaveBtn.classList.remove('is-loading');
  }
}

async function saveSandboxSettings() {
  const sandboxSaveBtn = document.getElementById('save-sandbox-btn');
  const fsInput = document.getElementById('fs-root');
  const allowInput = document.getElementById('shell-allow');
  const denyInput = document.getElementById('shell-deny');
  const policyInput = document.getElementById('shell-policy-display');
  const policy = policyInput ? (policyInput.getAttribute('data-value') || 'unrestricted') : 'unrestricted';

  if (sandboxSaveBtn) sandboxSaveBtn.classList.add('is-loading');
  try {
    await window.api.saveConfig({
      shellPolicy: policy,
      fsRoot: fsInput ? fsInput.value : '~/',
      shellAllowlist: allowInput ? allowInput.value.split(',').map(s => s.trim()).filter(Boolean) : [],
      shellDenylist: denyInput ? denyInput.value.split(',').map(s => s.trim()).filter(Boolean) : []
    });
    [fsInput, allowInput, denyInput].filter(Boolean).forEach(input => { input.dataset.savedValue = input.value; });
    if (policyInput) policyInput.dataset.savedValue = policy;
    if (sandboxSaveBtn) {
      sandboxSaveBtn.classList.remove('btn-primary');
      flashSaveFeedback(sandboxSaveBtn);
    }
    updateShellStatus(policy);
  } finally {
    if (sandboxSaveBtn) sandboxSaveBtn.classList.remove('is-loading');
  }
}

// Global high-priority click handler for buttons and tabs
document.addEventListener('click', (event) => {
  const target = event.target;
  if (!target) return;

  const saveNetwork = target.closest('#save-network-btn');
  if (saveNetwork) {
    event.preventDefault();
    saveNetworkSettings();
    return;
  }
  const saveAccess = target.closest('#save-access-btn');
  if (saveAccess) {
    event.preventDefault();
    saveAccessSettings();
    return;
  }
  const saveSandbox = target.closest('#save-sandbox-btn');
  if (saveSandbox) {
    event.preventDefault();
    saveSandboxSettings();
    return;
  }
  const tabSettings = target.closest('#tab-btn-settings');
  if (tabSettings) {
    event.preventDefault();
    switchMainTab('settings');
    return;
  }
  const tabLogs = target.closest('#tab-btn-logs');
  if (tabLogs) {
    event.preventDefault();
    switchMainTab('logs');
    return;
  }
  const subtabM = target.closest('#log-subtab-mcp');
  if (subtabM) {
    event.preventDefault();
    switchLogSubtab('mcp');
    return;
  }
  const subtabR = target.closest('#log-subtab-runtime');
  if (subtabR) {
    event.preventDefault();
    switchLogSubtab('runtime');
    return;
  }
  const exportBtn = target.closest('#export-safe-log-btn');
  if (exportBtn) {
    event.preventDefault();
    exportSafeLog();
    return;
  }
  const clearBtn = target.closest('#clear-all-logs-btn');
  if (clearBtn) {
    event.preventDefault();
    clearAllLogs();
    return;
  }

  if (target.closest?.('.input-combobox, .button-cluster, button, a')) return;
  closeDropdowns();
});

const listenAddressInput = document.getElementById('listen-host');
const listenAddressMenu = document.getElementById('listen-address-dropdown-menu');
const listenAddressArrow = document.getElementById('listen-address-arrow');
function toggleListenAddressMenu() {
  if (!listenAddressMenu || !listenAddressInput || !listenAddressArrow) return;
  const isVisible = listenAddressMenu.style.display === 'block';
  closeDropdowns(isVisible ? null : listenAddressMenu);
  setMenuVisibility(listenAddressMenu, listenAddressInput, listenAddressArrow, !isVisible);
  if (!isVisible) setActiveOption(listenAddressMenu, 0);
}
if (listenAddressInput && listenAddressArrow && listenAddressMenu) {
  listenAddressInput.addEventListener('click', toggleListenAddressMenu);
  listenAddressArrow.addEventListener('click', event => {
    event.stopPropagation();
    toggleListenAddressMenu();
  });
  listenAddressInput.addEventListener('keydown', event => handleComboboxKeydown(event, listenAddressMenu, listenAddressInput, listenAddressArrow));
  listenAddressArrow.addEventListener('keydown', event => handleComboboxKeydown(event, listenAddressMenu, listenAddressInput, listenAddressArrow));
}

function formatServerMcpUrl(baseUrl, mcpPath = '/mcp') {
  if (!baseUrl) return '';
  let trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  const pathPart = mcpPath && mcpPath.startsWith('/') ? mcpPath : `/${mcpPath || 'mcp'}`;
  if (trimmed.endsWith(pathPart)) return trimmed;
  return `${trimmed}${pathPart}`;
}

function createGuideRow(label, badgeText) {
  const row = document.createElement('div');
  row.className = 'guide-row';

  const labelSpan = document.createElement('span');
  labelSpan.textContent = label;

  const badge = document.createElement('span');
  badge.className = 'copyable-badge';
  badge.title = 'Double click to copy';
  badge.setAttribute('data-copy', badgeText);
  badge.textContent = badgeText;

  row.appendChild(labelSpan);
  row.appendChild(badge);
  return row;
}

function renderConnectionGuide(mode, url) {
  const container = document.getElementById('endpoint-guide-container');
  container.replaceChildren();

  const box = document.createElement('div');
  box.className = 'guide-box';

  const header = document.createElement('div');
  header.className = 'guide-box-header';

  const headerTitle = document.createElement('strong');
  const tagSpan = document.createElement('span');
  tagSpan.style.fontSize = '10px';
  tagSpan.style.fontWeight = '500';

  if (mode === 'openai') {
    const currentTunnelId = document.getElementById('openai-tunnel-id')?.value?.trim() || '';
    headerTitle.textContent = 'ChatGPT Connector Setup';
    tagSpan.style.color = 'var(--blue-300)';
    tagSpan.textContent = 'Private Channel';
    header.appendChild(headerTitle);
    header.appendChild(tagSpan);
    box.appendChild(header);

    if (currentTunnelId) {
      box.appendChild(createGuideRow('Tunnel ID', currentTunnelId));
    }
    box.appendChild(createGuideRow('Authentication', 'None (Outbound Ingress)'));
    box.appendChild(createGuideRow('Connection Type', 'Tunnel'));

    const note = document.createElement('small');
    note.style.color = 'var(--color-text-tertiary)';
    note.style.display = 'block';
    note.style.marginTop = '8px';
    note.textContent = 'In ChatGPT Custom App setup, select "Tunnel" and provide this Tunnel ID. No public URL or OAuth endpoint required.';
    box.appendChild(note);
  } else {
    const currentMcpPath = window.currentMcpPath || '/mcp';
    const fullMcpUrl = formatServerMcpUrl(url, currentMcpPath) || `https://mcp.yourdomain.com${currentMcpPath}`;
    headerTitle.textContent = 'ChatGPT / Claude Setup';
    tagSpan.style.color = 'var(--green-300)';
    tagSpan.textContent = 'OAuth 2.1 + CIMD';
    header.appendChild(headerTitle);
    header.appendChild(tagSpan);
    box.appendChild(header);

    box.appendChild(createGuideRow('Server URL', fullMcpUrl));
    box.appendChild(createGuideRow('Auth Method', 'OAuth 2.1 (Web Passcode)'));
    box.appendChild(createGuideRow('Discovery', 'CIMD + PRM Enabled'));

    const note = document.createElement('small');
    note.style.color = 'var(--color-text-tertiary)';
    note.style.display = 'block';
    note.style.marginTop = '8px';
    note.textContent = 'Paste the Server URL into ChatGPT. Double-click any parameter to copy.';
    box.appendChild(note);
  }

  // Bind double click to copy
  box.querySelectorAll('.copyable-badge').forEach(el => {
    el.addEventListener('dblclick', async () => {
      const textToCopy = el.getAttribute('data-copy');
      try {
        await navigator.clipboard.writeText(textToCopy);
        el.classList.add('copying');
        const originalNodes = Array.from(el.childNodes);
        el.replaceChildren();
        const copiedSpan = document.createElement('span');
        copiedSpan.style.color = 'var(--green-300)';
        copiedSpan.style.fontSize = '11px';
        copiedSpan.textContent = 'Copied ✓';
        el.appendChild(copiedSpan);
        setTimeout(() => {
          el.replaceChildren(...originalNodes);
          el.classList.remove('copying');
        }, 1200);
      } catch (err) {
        console.error('Failed to copy:', err);
      }
    });
  });

  container.appendChild(box);
}

async function reloadCfHostnames() {
  const urlInput = document.getElementById('mcp-url');
  const cfArrow = document.getElementById('cf-hostname-arrow');
  const dropdownMenu = document.getElementById('cf-dropdown-menu');
  const configPath = document.getElementById('cf-config-path').value;

  const cfInfo = await window.api.getCfHostnames(configPath);
  if (cfInfo && cfInfo.hostnames && cfInfo.hostnames.length > 0) {
    dropdownMenu.replaceChildren();
    cfInfo.hostnames.forEach(h => {
      const item = document.createElement('div');
      item.className = 'combobox-option';
      item.setAttribute('role', 'option');
      item.setAttribute('tabindex', '-1');
      item.setAttribute('aria-selected', 'false');

      const hostSpan = document.createElement('span');
      hostSpan.textContent = `https://${h}`;

      const hintSpan = document.createElement('span');
      hintSpan.style.color = 'var(--color-text-tertiary)';
      hintSpan.style.fontSize = '10px';
      hintSpan.textContent = 'ingress rule';

      item.appendChild(hostSpan);
      item.appendChild(hintSpan);

      item.addEventListener('click', (e) => {
        e.stopPropagation();
        urlInput.value = `https://${h}`;
        updateNetworkSaveState();
        setMenuVisibility(dropdownMenu, urlInput, cfArrow, false);
        const mode = document.getElementById('tunnel-mode-display').getAttribute('data-value') || 'cloudflare-named';
        renderConnectionGuide(mode, urlInput.value);
      });
      dropdownMenu.appendChild(item);
    });
    cfArrow.style.display = 'flex';
    cfArrow.disabled = false;
  } else {
    cfArrow.style.display = 'none';
  }
}

async function reloadCfConfigFiles() {
  const configInput = document.getElementById('cf-config-path');
  const configArrow = document.getElementById('cf-config-arrow');
  const configMenu = document.getElementById('cf-config-dropdown-menu');

  const configs = await window.api.discoverCfConfigs();
  if (configs && configs.length > 0) {
    configMenu.replaceChildren();
    configs.forEach(p => {
      const item = document.createElement('div');
      item.className = 'combobox-option';
      item.setAttribute('role', 'option');
      item.setAttribute('tabindex', '-1');
      item.setAttribute('aria-selected', 'false');

      const pathSpan = document.createElement('span');
      pathSpan.style.overflow = 'hidden';
      pathSpan.style.textOverflow = 'ellipsis';
      pathSpan.textContent = p;

      const tagSpan = document.createElement('span');
      tagSpan.style.color = 'var(--color-text-tertiary)';
      tagSpan.style.fontSize = '10px';
      tagSpan.style.flex = 'none';
      tagSpan.textContent = 'detected';

      item.appendChild(pathSpan);
      item.appendChild(tagSpan);

      item.addEventListener('click', (e) => {
        e.stopPropagation();
        configInput.value = p;
        setMenuVisibility(configMenu, configInput, configArrow, false);
        updateNetworkSaveState();
      });
      configMenu.appendChild(item);
    });
    configArrow.style.display = 'flex';
  } else {
    configArrow.style.display = 'none';
  }
}

async function reloadTunnelBinaries() {
  const binaryInput = document.getElementById('openai-binary-path');
  const binaryArrow = document.getElementById('openai-binary-arrow');
  const binaryMenu = document.getElementById('openai-binary-dropdown-menu');
  if (!binaryInput || !binaryArrow || !binaryMenu) return;

  const binaries = await window.api.discoverTunnelBinaries();
  if (binaries && binaries.length > 0) {
    binaryMenu.replaceChildren();
    binaries.forEach(p => {
      const item = document.createElement('div');
      item.className = 'combobox-option';
      item.setAttribute('role', 'option');
      item.setAttribute('tabindex', '-1');
      item.setAttribute('aria-selected', 'false');

      const pathSpan = document.createElement('span');
      pathSpan.style.overflow = 'hidden';
      pathSpan.style.textOverflow = 'ellipsis';
      pathSpan.textContent = p;

      const tagSpan = document.createElement('span');
      tagSpan.style.color = 'var(--color-text-tertiary)';
      tagSpan.style.fontSize = '10px';
      tagSpan.style.flex = 'none';
      tagSpan.textContent = 'detected';

      item.appendChild(pathSpan);
      item.appendChild(tagSpan);

      item.addEventListener('click', (e) => {
        e.stopPropagation();
        binaryInput.value = p;
        setMenuVisibility(binaryMenu, binaryInput, binaryArrow, false);
        updateNetworkSaveState();
      });
      binaryMenu.appendChild(item);
    });
    binaryArrow.style.display = 'flex';
    if (!binaryInput.value) {
      binaryInput.placeholder = `Auto-detected: ${binaries[0]}`;
    }
  } else {
    binaryArrow.style.display = 'none';
    if (!binaryInput.value) {
      binaryInput.placeholder = 'e.g. /usr/local/bin/tunnel-client';
    }
  }
}

async function reloadAcmeCerts() {
  const certInput = document.getElementById('custom-ssl-cert-path');
  const certArrow = document.getElementById('custom-ssl-cert-arrow');
  const certMenu = document.getElementById('custom-ssl-cert-dropdown-menu');
  const keyInput = document.getElementById('custom-ssl-key-path');
  const mcpUrlInput = document.getElementById('mcp-url');
  if (!certInput || !certArrow || !certMenu) return;

  try {
    const certs = await window.api.discoverAcmeCerts();
    if (certs && certs.length > 0) {
      certMenu.replaceChildren();
      certs.forEach(cert => {
        const item = document.createElement('div');
        item.className = 'combobox-option';
        item.setAttribute('role', 'option');
        item.setAttribute('tabindex', '-1');
        item.setAttribute('aria-selected', 'false');

        const domainSpan = document.createElement('span');
        domainSpan.textContent = `${cert.domain} ${cert.isEcc ? '(ECC)' : ''}`;

        const tagSpan = document.createElement('span');
        tagSpan.style.color = 'var(--color-text-tertiary)';
        tagSpan.style.fontSize = '10px';
        tagSpan.style.flex = 'none';
        tagSpan.textContent = 'detected';

        item.appendChild(domainSpan);
        item.appendChild(tagSpan);

        item.addEventListener('click', (e) => {
          e.stopPropagation();
          certInput.value = cert.certPath;
          if (keyInput && cert.keyPath) {
            keyInput.value = cert.keyPath;
          }
          if (mcpUrlInput && (!mcpUrlInput.value || mcpUrlInput.value.includes('mcp.yourdomain.com'))) {
            mcpUrlInput.value = `https://${cert.domain}`;
          }
          setMenuVisibility(certMenu, certInput, certArrow, false);
          updateNetworkSaveState();
          const mode = getCurrentMode();
          renderConnectionGuide(mode, mcpUrlInput ? mcpUrlInput.value : '');
        });
        certMenu.appendChild(item);
      });
      certArrow.style.display = 'flex';
      if (!certInput.value) {
        certInput.placeholder = `Detected: ${certs[0].domain}`;
      }
    } else {
      certArrow.style.display = 'none';
      if (!certInput.value) {
        certInput.placeholder = 'e.g. ~/.acme.sh/domain/fullchain.cer';
      }
    }
  } catch (err) {
    console.error('Failed to load acme certs:', err);
  }
}

async function updateTunnelModeFields(mode) {
  const urlInput = document.getElementById('mcp-url');
  const hintEl = document.getElementById('tunnel-install-hint');
  const linkEl = document.getElementById('tunnel-doc-link');
  const cfArrow = document.getElementById('cf-hostname-arrow');
  const cfConfigRow = document.getElementById('cf-config-row');
  const mcpUrlRow = document.getElementById('mcp-url-row');
  const openaiBinaryRow = document.getElementById('openai-binary-row');
  const openaiTunnelIdRow = document.getElementById('openai-tunnel-id-row');
  const openaiApiKeyRow = document.getElementById('openai-api-key-row');
  const customSslCertRow = document.getElementById('custom-ssl-cert-row');
  const customSslKeyRow = document.getElementById('custom-ssl-key-row');
  const tokensContainer = document.getElementById('tokens-container');
  const openaiNotice = document.getElementById('openai-connections-notice');

  urlInput.style.color = 'var(--color-text-primary)';
  closeDropdowns();

  if (mode === 'openai') {
    if (cfConfigRow) cfConfigRow.style.display = 'none';
    if (mcpUrlRow) mcpUrlRow.style.display = 'none';
    if (openaiBinaryRow) openaiBinaryRow.style.display = 'grid';
    if (openaiTunnelIdRow) openaiTunnelIdRow.style.display = 'grid';
    if (openaiApiKeyRow) openaiApiKeyRow.style.display = 'grid';
    if (customSslCertRow) customSslCertRow.style.display = 'none';
    if (customSslKeyRow) customSslKeyRow.style.display = 'none';
    if (tokensContainer) tokensContainer.style.display = 'none';
    if (openaiNotice) openaiNotice.style.display = 'block';

    cfArrow.style.display = 'none';
    hintEl.style.display = 'block';
    linkEl.textContent = 'openai/tunnel-client';
    await reloadTunnelBinaries();
  } else if (mode === 'cloudflare-quick') {
    if (cfConfigRow) cfConfigRow.style.display = 'none';
    if (mcpUrlRow) mcpUrlRow.style.display = 'grid';
    if (openaiBinaryRow) openaiBinaryRow.style.display = 'none';
    if (openaiTunnelIdRow) openaiTunnelIdRow.style.display = 'none';
    if (openaiApiKeyRow) openaiApiKeyRow.style.display = 'none';
    if (customSslCertRow) customSslCertRow.style.display = 'none';
    if (customSslKeyRow) customSslKeyRow.style.display = 'none';
    if (tokensContainer) tokensContainer.style.display = 'block';
    if (openaiNotice) openaiNotice.style.display = 'none';

    urlInput.readOnly = true;
    urlInput.style.backgroundColor = 'var(--color-background-control)';
    cfArrow.style.display = 'none';
    hintEl.style.display = 'block';
    linkEl.textContent = 'cloudflared';
  } else if (mode === 'cloudflare-named') {
    if (cfConfigRow) cfConfigRow.style.display = 'grid';
    if (mcpUrlRow) mcpUrlRow.style.display = 'grid';
    if (openaiBinaryRow) openaiBinaryRow.style.display = 'none';
    if (openaiTunnelIdRow) openaiTunnelIdRow.style.display = 'none';
    if (openaiApiKeyRow) openaiApiKeyRow.style.display = 'none';
    if (customSslCertRow) customSslCertRow.style.display = 'none';
    if (customSslKeyRow) customSslKeyRow.style.display = 'none';
    if (tokensContainer) tokensContainer.style.display = 'block';
    if (openaiNotice) openaiNotice.style.display = 'none';

    urlInput.readOnly = false;
    urlInput.style.backgroundColor = 'var(--color-background-control)';
    hintEl.style.display = 'block';
    linkEl.textContent = 'cloudflared';
    await reloadCfConfigFiles();
    await reloadCfHostnames();
  } else {
    if (cfConfigRow) cfConfigRow.style.display = 'none';
    if (mcpUrlRow) mcpUrlRow.style.display = 'grid';
    if (openaiBinaryRow) openaiBinaryRow.style.display = 'none';
    if (openaiTunnelIdRow) openaiTunnelIdRow.style.display = 'none';
    if (openaiApiKeyRow) openaiApiKeyRow.style.display = 'none';
    if (customSslCertRow) customSslCertRow.style.display = 'grid';
    if (customSslKeyRow) customSslKeyRow.style.display = 'grid';
    if (tokensContainer) tokensContainer.style.display = 'block';
    if (openaiNotice) openaiNotice.style.display = 'none';

    urlInput.readOnly = false;
    urlInput.style.backgroundColor = 'var(--color-background-control)';
    cfArrow.style.display = 'none';
    hintEl.style.display = 'block';
    hintEl.innerHTML = 'Optional SSL: Auto-scans <code>~/.acme.sh</code> for certificates or select local cert/key for HTTPS proxy.';
    await reloadAcmeCerts();
  }
  renderConnectionGuide(mode, urlInput.value);
  updateNetworkSaveState();
}

window.api.onUrlUpdated((url) => {
  const currentMode = getCurrentMode();
  if (currentMode === 'cloudflare-quick') {
    const mcpUrlInput = document.getElementById('mcp-url');
    if (mcpUrlInput) {
      mcpUrlInput.value = url;
      mcpUrlInput.dataset.savedValue = url;
    }
  }
  updateNetworkSaveState();
  renderConnectionGuide(currentMode, url);
});

// --- Tab Switcher (Settings / Logs) & Sub-tabs Initialized in switchMainTab/switchLogSubtab ---
function updateMcpMetrics() {
  const total = mcpLogs.length;
  const success = mcpLogs.filter(l => l.result === 'Success').length;
  const errors = total - success;

  document.getElementById('metric-total-calls').textContent = String(total);
  document.getElementById('metric-success-calls').textContent = String(success);
  document.getElementById('metric-error-calls').textContent = String(errors);
}

function renderHttpLogItem(entry) {
  const emptyState = document.getElementById('http-empty-state');
  if (emptyState) emptyState.remove();

  const container = document.getElementById('http-table-container');
  if (!container) return;

  const details = document.createElement('details');
  details.className = 'activity-item http-log-item';

  const isSuccess = entry.status < 400;
  const isWarn = entry.status >= 400 && entry.status < 500;
  const statusGroup = entry.status >= 500 ? '5xx' : (entry.status >= 400 ? '4xx' : (entry.status >= 300 ? '3xx' : '2xx'));
  const method = (entry.method || 'GET').toUpperCase();
  const time = new Date(entry.timestamp).toLocaleTimeString();
  const durationText = entry.duration !== undefined ? `${entry.duration}ms` : '';

  // Summary row
  const summary = document.createElement('summary');

  const dot = document.createElement('div');
  dot.className = `activity-dot ${isSuccess ? 'is-success' : (isWarn ? 'is-warn' : 'is-error')}`;

  const meta = document.createElement('div');
  meta.className = 'activity-meta';

  const headerLine = document.createElement('div');
  headerLine.className = 'activity-header-line';

  const methodBadge = document.createElement('span');
  methodBadge.className = `http-method-badge http-method-${method}`;
  methodBadge.textContent = method;

  const statusBadge = document.createElement('span');
  statusBadge.className = `http-status-badge http-status-${statusGroup}`;
  statusBadge.textContent = String(entry.status);

  const urlSpan = document.createElement('span');
  urlSpan.className = 'activity-summary-text';
  urlSpan.textContent = `${entry.url} (${entry.ip || '127.0.0.1'})`;

  headerLine.appendChild(methodBadge);
  headerLine.appendChild(statusBadge);
  headerLine.appendChild(urlSpan);
  meta.appendChild(headerLine);

  const timeWrapper = document.createElement('div');
  timeWrapper.style.display = 'flex';
  timeWrapper.style.alignItems = 'center';
  timeWrapper.style.gap = '8px';

  if (durationText) {
    const durationSpan = document.createElement('span');
    durationSpan.style.fontSize = '10px';
    durationSpan.style.color = 'var(--color-text-tertiary)';
    durationSpan.textContent = durationText;
    timeWrapper.appendChild(durationSpan);
  }

  const timeEl = document.createElement('time');
  timeEl.className = 'activity-time';
  timeEl.textContent = time;
  timeWrapper.appendChild(timeEl);

  const chevron = document.createElement('div');
  chevron.className = 'activity-chevron';
  chevron.textContent = '▶';

  summary.appendChild(dot);
  summary.appendChild(meta);
  summary.appendChild(timeWrapper);
  summary.appendChild(chevron);

  // Details panel
  const panel = document.createElement('div');
  panel.className = 'activity-details-panel';

  const reqSection = document.createElement('div');
  const reqLabel = document.createElement('div');
  reqLabel.style.fontSize = '10px';
  reqLabel.style.fontWeight = '600';
  reqLabel.style.color = 'var(--color-text-tertiary)';
  reqLabel.style.textTransform = 'uppercase';
  reqLabel.style.marginBottom = '4px';
  reqLabel.textContent = 'Request Overview';

  const reqInfo = {
    method: entry.method,
    url: entry.url,
    status: entry.status,
    clientIp: entry.ip,
    authHeader: entry.auth || 'None',
    userAgent: entry.userAgent || 'Unknown',
    duration: `${entry.duration}ms`,
    timestamp: entry.timestamp
  };

  const reqCode = document.createElement('pre');
  reqCode.className = 'activity-code-block';
  reqCode.textContent = JSON.stringify(reqInfo, null, 2);

  reqSection.appendChild(reqLabel);
  reqSection.appendChild(reqCode);
  panel.appendChild(reqSection);

  details.appendChild(summary);
  details.appendChild(panel);

  if (container.firstChild) {
    container.insertBefore(details, container.firstChild);
  } else {
    container.appendChild(details);
  }
}

function renderMcpLogItem(entry) {
  const emptyState = document.getElementById('activity-empty-state');
  if (emptyState) emptyState.remove();

  const container = document.getElementById('activity-table-container');
  const details = document.createElement('details');
  details.className = 'activity-item';

  const isSuccess = entry.result === 'Success';
  const time = new Date(entry.timestamp).toLocaleTimeString();
  const durationText = entry.duration !== undefined ? `${entry.duration}ms` : '';

  // Param summary text
  let summaryText = '';
  if (entry.params) {
    if (entry.params.command) summaryText = entry.params.command;
    else if (entry.params.path) summaryText = entry.params.path;
    else summaryText = JSON.stringify(entry.params);
  }
  if (summaryText.length > 80) summaryText = `${summaryText.slice(0, 80)}…`;

  // Summary row
  const summary = document.createElement('summary');

  const dot = document.createElement('div');
  dot.className = `activity-dot ${isSuccess ? 'is-success' : 'is-error'}`;

  const meta = document.createElement('div');
  meta.className = 'activity-meta';

  const headerLine = document.createElement('div');
  headerLine.className = 'activity-header-line';

  const toolBadge = document.createElement('span');
  toolBadge.className = 'tool-badge';
  toolBadge.textContent = entry.tool || 'tool';

  const summarySpan = document.createElement('span');
  summarySpan.className = 'activity-summary-text';
  summarySpan.textContent = summaryText;

  headerLine.appendChild(toolBadge);
  headerLine.appendChild(summarySpan);
  meta.appendChild(headerLine);

  const timeWrapper = document.createElement('div');
  timeWrapper.style.display = 'flex';
  timeWrapper.style.alignItems = 'center';
  timeWrapper.style.gap = '8px';

  if (durationText) {
    const durationSpan = document.createElement('span');
    durationSpan.style.fontSize = '10px';
    durationSpan.style.color = 'var(--color-text-tertiary)';
    durationSpan.textContent = durationText;
    timeWrapper.appendChild(durationSpan);
  }

  const timeEl = document.createElement('time');
  timeEl.className = 'activity-time';
  timeEl.textContent = time;
  timeWrapper.appendChild(timeEl);

  const chevron = document.createElement('div');
  chevron.className = 'activity-chevron';
  chevron.textContent = '▶';

  summary.appendChild(dot);
  summary.appendChild(meta);
  summary.appendChild(timeWrapper);
  summary.appendChild(chevron);

  // Details panel
  const panel = document.createElement('div');
  panel.className = 'activity-details-panel';

  // Section 1: Arguments
  const argsSection = document.createElement('div');
  const argsLabel = document.createElement('div');
  argsLabel.style.fontSize = '10px';
  argsLabel.style.fontWeight = '600';
  argsLabel.style.color = 'var(--color-text-tertiary)';
  argsLabel.style.textTransform = 'uppercase';
  argsLabel.style.marginBottom = '4px';
  argsLabel.textContent = 'Arguments';

  const argsCode = document.createElement('pre');
  argsCode.className = 'activity-code-block';
  argsCode.textContent = JSON.stringify(entry.params || {}, null, 2);

  argsSection.appendChild(argsLabel);
  argsSection.appendChild(argsCode);

  // Section 2: Response / Error Output
  const resSection = document.createElement('div');
  const resLabel = document.createElement('div');
  resLabel.style.fontSize = '10px';
  resLabel.style.fontWeight = '600';
  resLabel.style.color = isSuccess ? 'var(--color-text-tertiary)' : 'var(--red-300)';
  resLabel.style.textTransform = 'uppercase';
  resLabel.style.marginBottom = '4px';
  resLabel.textContent = isSuccess ? 'Response Output' : 'Error Detail';

  const resCode = document.createElement('pre');
  resCode.className = 'activity-code-block';
  if (!isSuccess) {
    resCode.style.color = 'var(--red-300)';
    resCode.style.borderColor = 'rgba(255, 103, 100, 0.3)';
  }
  resCode.textContent = entry.error || entry.output || '(No response output)';

  resSection.appendChild(resLabel);
  resSection.appendChild(resCode);

  panel.appendChild(argsSection);
  panel.appendChild(resSection);

  details.appendChild(summary);
  details.appendChild(panel);

  if (container.firstChild) {
    container.insertBefore(details, container.firstChild);
  } else {
    container.appendChild(details);
  }
}

function appendRuntimeLog(entry) {
  const stream = document.getElementById('runtime-log-stream');
  if (!stream) return;

  const line = document.createElement('div');
  const levelClass = entry.level === 'error' ? 'is-error' : entry.level === 'warn' ? 'is-warn' : entry.level === 'debug' ? 'is-debug' : '';
  line.className = `log-line ${levelClass}`;

  const time = new Date(entry.timestamp).toLocaleTimeString();
  const sourceTag = (entry.source || 'System').toLowerCase();

  const timeSpan = document.createElement('span');
  timeSpan.style.color = 'var(--color-text-disabled)';
  timeSpan.style.fontSize = '10px';
  timeSpan.style.marginRight = '6px';
  timeSpan.textContent = `[${time}]`;

  const tagSpan = document.createElement('span');
  tagSpan.className = `log-tag tag-${sourceTag}`;
  tagSpan.textContent = `[${entry.source || 'System'}]`;

  const msgSpan = document.createElement('span');
  msgSpan.textContent = entry.message || '';

  line.appendChild(timeSpan);
  line.appendChild(tagSpan);
  line.appendChild(msgSpan);

  if (entry.detail) {
    const detailToggle = document.createElement('button');
    detailToggle.className = 'runtime-detail-toggle';
    detailToggle.textContent = 'Show details';

    const detailPre = document.createElement('pre');
    detailPre.className = 'runtime-detail-panel';
    detailPre.hidden = true;
    detailPre.textContent = JSON.stringify(entry.detail, null, 2);

    detailToggle.addEventListener('click', () => {
      detailPre.hidden = !detailPre.hidden;
      detailToggle.textContent = detailPre.hidden ? 'Show details' : 'Hide details';
    });

    line.appendChild(detailToggle);
    line.appendChild(detailPre);
  }

  stream.appendChild(line);
  stream.scrollTop = stream.scrollHeight;
}

// Redact sensitive patterns for Safe Log export (tokens, keys, secrets)
function redactSafeText(text) {
  return String(text ?? '')
    .replace(/mcp_[ar]t_[A-Za-z0-9_-]{20,}/g, '[mcp-token-redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~-]{20,}\b/gi, 'Bearer [redacted]')
    .replace(/\/Users\/[^\/\s"']+/g, '/Users/[username]')
    .replace(/C:\\Users\\[^\/\s"'\\]+/g, 'C:\\Users\\[username]');
}

// --- Export & Clear Buttons ---
async function exportSafeLog() {
  const exportBtn = document.getElementById('export-safe-log-btn');
  const safeJsonParse = (str, fallback = null) => {
    try {
      return JSON.parse(str);
    } catch {
      return fallback;
    }
  };

  const exportPayload = {
    exportedAt: new Date().toISOString(),
    mcpInvocations: mcpLogs.map(l => ({
      ...l,
      params: safeJsonParse(redactSafeText(JSON.stringify(l.params || {})), l.params),
      output: redactSafeText(l.output || ''),
      error: redactSafeText(l.error || '')
    })),
    httpRequests: httpLogs.map(l => ({
      ...l,
      url: redactSafeText(l.url),
      ip: redactSafeText(l.ip)
    })),
    runtimeLogs: runtimeLogs.map(l => ({
      ...l,
      message: redactSafeText(l.message),
      detail: l.detail ? safeJsonParse(redactSafeText(JSON.stringify(l.detail)), l.detail) : null
    }))
  };

  try {
    await navigator.clipboard.writeText(JSON.stringify(exportPayload, null, 2));
    if (exportBtn) {
      const originalText = exportBtn.textContent;
      exportBtn.textContent = 'Copied ✓';
      exportBtn.classList.add('btn-success');
      setTimeout(() => {
        exportBtn.textContent = originalText;
        exportBtn.classList.remove('btn-success');
      }, 1400);
    }
  } catch (err) {
    console.error('Failed to export log to clipboard:', err);
    if (exportBtn) {
      const originalText = exportBtn.textContent;
      exportBtn.textContent = 'Copy Failed';
      setTimeout(() => {
        exportBtn.textContent = originalText;
      }, 1400);
    }
  }
}

function clearAllLogs() {
  const clearBtn = document.getElementById('clear-all-logs-btn');
  mcpLogs.length = 0;
  httpLogs.length = 0;
  runtimeLogs.length = 0;

  const tableContainer = document.getElementById('activity-table-container');
  if (tableContainer) {
    tableContainer.replaceChildren();
    const empty = document.createElement('div');
    empty.className = 'activity-empty';
    empty.id = 'activity-empty-state';
    empty.textContent = 'Logs cleared. Waiting for new activity...';
    tableContainer.appendChild(empty);
  }

  const httpContainer = document.getElementById('http-table-container');
  if (httpContainer) {
    httpContainer.replaceChildren();
    const empty = document.createElement('div');
    empty.className = 'activity-empty';
    empty.id = 'http-empty-state';
    empty.textContent = 'HTTP request logs cleared.';
    httpContainer.appendChild(empty);
  }

  const stream = document.getElementById('runtime-log-stream');
  if (stream) {
    stream.replaceChildren();
    const initLine = document.createElement('div');
    initLine.className = 'log-line';
    initLine.innerHTML = '<span class="log-tag tag-system">[System]</span><span>Logs cleared.</span>';
    stream.appendChild(initLine);
  }

  updateMcpMetrics();

  if (clearBtn) {
    const originalText = clearBtn.textContent;
    clearBtn.textContent = 'Cleared ✓';
    clearBtn.classList.add('btn-success');
    setTimeout(() => {
      clearBtn.textContent = originalText;
      clearBtn.classList.remove('btn-success');
    }, 1400);
  }
}

window.exportSafeLog = exportSafeLog;
window.clearAllLogs = clearAllLogs;
