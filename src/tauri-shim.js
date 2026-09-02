(() => {
  if (window.api || !window.__TAURI__) return;

  const { invoke } = window.__TAURI__.core;
  const { listen } = window.__TAURI__.event;
  const on = (eventName, callback) => {
    listen(eventName, event => callback(event.payload)).catch(error => {
      console.error(`Failed to listen for ${eventName}:`, error);
    });
  };

  window.api = {
    saveSecret: secret => invoke('save_secret', { secret }),
    getConfig: mode => invoke('get_config', { mode: mode || null }),
    getPiCapabilities: () => invoke('get_pi_capabilities'),
    getCfHostnames: customPath => invoke('get_cf_hostnames', { customPath: customPath || '' }),
    getListenAddresses: () => invoke('get_listen_addresses'),
    discoverCfConfigs: () => invoke('discover_cf_configs'),
    getServiceState: () => invoke('get_service_state'),
    toggleServiceState: connect => invoke('toggle_service_state', { connect }),
    saveConfig: cfg => invoke('save_config', { cfg }),
    saveProviderConfig: (mode, updates) => invoke('save_provider_config', { mode, updates }),
    getTokens: () => invoke('get_tokens'),
    getRecentLogs: () => invoke('get_recent_logs'),
    clearLogs: () => invoke('clear_recent_logs'),
    revokeToken: token => invoke('revoke_token', { token }),
    restartTunnel: mode => invoke('restart_tunnel', { mode: mode || null }),
    openExternal: url => invoke('open_external', { url }),
    pickCfConfig: () => invoke('pick_cf_config'),
    inspectCfConfig: path => invoke('get_cf_hostnames', { customPath: path || '' }),
    discoverTunnelBinaries: mode => invoke('discover_tunnel_binaries', { mode }),
    discoverAcmeCerts: () => invoke('discover_acme_certs'),
    pickCertFile: () => invoke('pick_cert_file'),
    pickKeyFile: () => invoke('pick_key_file'),
    validateSslFiles: (certPath, keyPath) => invoke('validate_ssl_files', { certPath, keyPath }),
    onUrlUpdated: callback => on('url-updated', callback),
    onServiceStateChanged: callback => on('service-state-changed', callback),
    onMcpLog: callback => on('mcp-log', callback),
    onTunnelLog: callback => on('tunnel-log', callback),
    onRuntimeLog: callback => on('runtime-log', callback)
  };
})();
