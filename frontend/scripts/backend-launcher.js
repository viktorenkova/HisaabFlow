const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

class BackendLauncher {
  constructor(userDir = null) {
    this.backendProcess = null;
    this.isRunning = false;
    this.port = 8000;
    this.userDir = userDir;
    this.backendPid = null; // Track PID separately for Windows
    this.backendExecutableName = null; // Track executable name
    this.lastStartupError = null;
    this.launchLogPath = null;
    this.backendLogPath = null;
    this.initializeLogging();
  }

  initializeLogging() {
    const baseDir = this.userDir || path.join(os.homedir(), 'HisaabFlow');
    const logDir = path.join(baseDir, 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    this.launchLogPath = path.join(logDir, 'electron-backend-launcher.log');
    this.backendLogPath = path.join(logDir, 'backend-runtime.log');
  }

  writeLogLine(filePath, message) {
    const line = `[${new Date().toISOString()}] ${message}\n`;
    try {
      fs.appendFileSync(filePath, line, 'utf8');
    } catch (error) {
      console.error(`[LOGGER] Failed to write log file ${filePath}:`, error);
    }
  }

  log(level, message, meta = null) {
    const fullMessage = meta ? `${message} ${JSON.stringify(meta)}` : message;
    const logLine = `[${level}] ${fullMessage}`;
    if (level === 'ERROR') {
      console.error(logLine);
    } else if (level === 'WARN') {
      console.warn(logLine);
    } else {
      console.log(logLine);
    }
    this.writeLogLine(this.launchLogPath, logLine);
  }

  logBackendOutput(stream, message) {
    const trimmedMessage = message.toString().trim();
    if (!trimmedMessage) {
      return;
    }
    const logLine = `[${stream}] ${trimmedMessage}`;
    if (stream === 'STDERR') {
      console.error(`[BACKEND] ${trimmedMessage}`);
    } else {
      console.log(`[BACKEND] ${trimmedMessage}`);
    }
    this.writeLogLine(this.backendLogPath, logLine);
  }

  getLogFilePaths() {
    return {
      launcherLog: this.launchLogPath,
      backendLog: this.backendLogPath
    };
  }

  async startBackend() {
    this.log('INFO', 'Starting HisaabFlow backend', {
      platform: process.platform,
      resourcesPath: process.resourcesPath,
      scriptDir: __dirname,
      port: this.port,
      userDir: this.userDir,
      startupMode: 'bundled-python-only'
    });
    return this.startPythonBackend();
  }

  async startPythonBackend() {
    this.log('INFO', 'Using bundled Python backend startup path');
    
    try {
      const backendPath = this.getBackendPath();
      const backendExists = fs.existsSync(backendPath);
      this.log('INFO', 'Resolved backend path', { backendPath, exists: backendExists });

      if (!backendExists) {
        throw new Error(`Backend path not found: ${backendPath}`);
      }

      const backendFiles = fs.readdirSync(backendPath);
      this.log('INFO', 'Backend directory contents', { backendFiles });
      
      // Ensure virtual environment exists and get Python path
      const pythonPath = await this.ensureVenv();
      const pythonExists = fs.existsSync(pythonPath);
      this.log('INFO', 'Resolved Python path', { pythonPath, exists: pythonExists });
      if (!pythonExists) {
        throw new Error(`Python runtime not found: ${pythonPath}`);
      }
      
      // Test Python execution
      console.log('🧪 Testing Python execution...');
      const testResult = await this.testPython(pythonPath);
      console.log(`🧪 Python test result: ${testResult}`);
      
      // Start FastAPI server using uvicorn
      // Set up environment with user configs directory and UTF-8 support
      const env = { 
        ...process.env, 
        PYTHONPATH: backendPath,
        // Force UTF-8 encoding for cross-platform compatibility
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8'
      };
      
      if (this.userDir) {
        env.HISAABFLOW_USER_DIR = this.userDir;
        env.HISAABFLOW_CONFIG_DIR = path.join(this.userDir, 'configs');
        this.log('INFO', 'Using user config directory', { configDir: env.HISAABFLOW_CONFIG_DIR });
      }
      
      this.backendProcess = spawn(pythonPath, [
        '-m', 'uvicorn',
        'main:app',
        '--host', '127.0.0.1',
        '--port', this.port.toString(),
        '--log-level', 'info'
      ], {
        cwd: backendPath,
        env: env,
        // Windows: Keep attached for proper process management
        // Unix: Detach for process group control
        detached: process.platform !== 'win32'
      });
      
      // Track process details for Windows cleanup
      this.backendPid = this.backendProcess.pid;
      this.backendExecutableName = path.basename(pythonPath);
      this.log('INFO', 'Spawned backend process', {
        pid: this.backendPid,
        executable: this.backendExecutableName,
        backendPath,
        pythonPath,
        configDir: env.HISAABFLOW_CONFIG_DIR || null
      });

      this.setupProcessHandlers();
      
      // Wait for backend to be ready
      await this.waitForBackend();
      this.isRunning = true;
      this.lastStartupError = null;
      
      this.log('INFO', 'Python backend started successfully');
      return true;
      
    } catch (error) {
      this.lastStartupError = error;
      this.log('ERROR', 'Failed to start Python backend', { message: error.message });
      return false;
    }
  }

  setupProcessHandlers() {
    this.backendProcess.stdout.on('data', (data) => {
      this.logBackendOutput('STDOUT', data);
    });

    this.backendProcess.stderr.on('data', (data) => {
      this.logBackendOutput('STDERR', data);
    });

    this.backendProcess.on('close', (code) => {
      this.log('WARN', 'Backend process closed', { code });
      this.isRunning = false;
      this.backendProcess = null; // Clear the reference
      this.backendPid = null; // Clear PID tracking
    });

    this.backendProcess.on('exit', (code, signal) => {
      this.log('WARN', 'Backend process exited', { code, signal });
      this.isRunning = false;
      this.backendProcess = null; // Clear the reference
      this.backendPid = null; // Clear PID tracking
    });

    this.backendProcess.on('error', (error) => {
      this.log('ERROR', 'Backend process error', { message: error.message });
      this.isRunning = false;
      this.backendProcess = null; // Clear the reference
      this.backendPid = null; // Clear PID tracking
    });
  }

  async waitForBackend(maxAttempts = 90) {
    const axios = require('axios');
    
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await axios.get(`http://127.0.0.1:${this.port}/health`);
        const health = response.data || {};

        if (health.status !== 'healthy' || health.routers_available === false) {
          const error = new Error(
            health.detail || 'Backend started without required API routes'
          );
          error.nonRetryable = true;
          throw error;
        }

        return true;
      } catch (error) {
        if (error.nonRetryable) {
          throw error;
        }
        if (!this.backendProcess) {
          throw new Error('Backend process exited before becoming healthy');
        }
        console.log(`⏳ Waiting for backend... (${i + 1}/${maxAttempts})`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    throw new Error(`Backend failed to start within ${maxAttempts} seconds`);
  }

  async tryHttpShutdown() {
    try {
      const axios = require('axios');
      
      // Send shutdown request with short timeout
      const response = await axios.post(`http://127.0.0.1:${this.port}/shutdown`, {}, {
        timeout: 2000,
        headers: { 'Content-Type': 'application/json' }
      });
      
      this.log('INFO', 'Shutdown request sent', { response: response.data });
      
      // Wait for process to actually exit
      const processExited = await this.waitForProcessExit(3000);
      
      if (processExited) {
        this.log('INFO', 'Process exited after HTTP shutdown');
        return true;
      } else {
        this.log('WARN', 'Process did not exit after HTTP shutdown');
        return false;
      }
      
    } catch (error) {
      this.log('WARN', 'HTTP shutdown failed', { message: error.message });
      return false;
    }
  }

  async waitForProcessExit(timeoutMs = 3000) {
    return new Promise((resolve) => {
      if (!this.backendProcess) {
        resolve(true);
        return;
      }
      
      let exited = false;
      
      const onExit = () => {
        if (!exited) {
          exited = true;
          resolve(true);
        }
      };
      
      this.backendProcess.once('exit', onExit);
      this.backendProcess.once('close', onExit);
      
      // Timeout fallback
      setTimeout(() => {
        if (!exited) {
          exited = true;
          resolve(false);
        }
      }, timeoutMs);
    });
  }

  getBackendPath() {
    const isDev = require('electron-is-dev');
    
    if (isDev) {
      // Development: backend folder in project root
      return path.join(__dirname, '../../backend');
    } else {
      // Production: backend in extraResources (fallback for development)
      return path.join(process.resourcesPath, 'backend');
    }
  }

  getBundledPythonPath() {
    const isDev = require('electron-is-dev');
    console.log(` isDev: ${isDev}`);
    
    if (isDev) {
      // Development: check for local python bundle first
      const localBundle = path.join(__dirname, '../python-bundle/python');
      if (require('fs').existsSync(localBundle)) {
        const pythonExe = process.platform === 'win32' 
          ? path.join(localBundle, 'python.exe')
          : path.join(localBundle, 'bin', 'python3');
        console.log(` Dev bundle Python: ${pythonExe}`);
        return pythonExe;
      }
      return null; // Fall back to system Python in development
    } else {
      // Production: use bundled python-build-standalone Python (not used with Nuitka)
      const bundlePath = path.join(process.resourcesPath, 'python-bundle/python');
      console.log(` Production bundle path: ${bundlePath}`);
      
      const pythonExe = process.platform === 'win32' 
        ? path.join(bundlePath, 'python.exe')
        : path.join(bundlePath, 'bin', 'python3');
      console.log(` Production Python executable: ${pythonExe}`);
      return pythonExe;
    }
  }

  getVenvPath() {
    return path.join(os.homedir(), '.hisaabflow', 'venv');
  }

  getVenvPython() {
    const venvPath = this.getVenvPath();
    return process.platform === 'win32' 
      ? path.join(venvPath, 'Scripts', 'python.exe')
      : path.join(venvPath, 'bin', 'python3');
  }

  async ensureVenv() {
    // First check if we have bundled Python
    const bundledPython = this.getBundledPythonPath();
    console.log(` Bundled Python path: ${bundledPython}`);
    
    if (bundledPython && require('fs').existsSync(bundledPython)) {
      console.log('[SUCCESS] Using bundled Python runtime');
      return bundledPython;
    } else {
      console.log(`[WARNING] Bundled Python not found at: ${bundledPython}`);
      if (bundledPython) {
        const bundleDir = require('path').dirname(bundledPython);
        console.log(` Bundle directory exists: ${require('fs').existsSync(bundleDir)}`);
        if (require('fs').existsSync(bundleDir)) {
          const bundleFiles = require('fs').readdirSync(bundleDir);
          console.log(` Files in bundle dir: ${bundleFiles.join(', ')}`);
        }
      }
    }
    
    // Fall back to virtual environment approach (for development)
    console.log('[WARNING] Bundled Python not found, using virtual environment...');
    const venvPath = this.getVenvPath();
    
    if (!require('fs').existsSync(venvPath)) {
      console.log(' Creating HisaabFlow virtual environment...');
      await this.createVenv();
      console.log(' Installing dependencies...');
      await this.installDependencies();
    }
    
    return this.getVenvPython();
  }

  async createVenv() {
    const venvPath = this.getVenvPath();
    
    return new Promise((resolve, reject) => {
      const create = spawn('python3', ['-m', 'venv', venvPath], { stdio: 'pipe' });
      
      create.on('close', (code) => {
        if (code === 0) {
          console.log('[SUCCESS] Virtual environment created');
          resolve();
        } else {
          reject(new Error('Failed to create virtual environment'));
        }
      });
    });
  }

  async installDependencies() {
    const venvPython = this.getVenvPython();
    
    return new Promise((resolve, reject) => {
      const install = spawn(venvPython, ['-m', 'pip', 'install', 
        'fastapi', 'uvicorn', 'pydantic', 'python-multipart',
        '--only-binary=pandas', 'pandas'
      ], { stdio: 'pipe' });
      
      install.on('close', (code) => {
        if (code === 0) {
          console.log('[SUCCESS] Dependencies installed successfully');
          resolve();
        } else {
          console.warn('[WARNING] Some dependencies failed, trying core only...');
          this.installCoreDependencies().then(resolve).catch(reject);
        }
      });
    });
  }

  async installCoreDependencies() {
    const venvPython = this.getVenvPython();
    
    return new Promise((resolve, reject) => {
      const install = spawn(venvPython, ['-m', 'pip', 'install', 
        'fastapi', 'uvicorn', 'pydantic', 'python-multipart'
      ], { stdio: 'pipe' });
      
      install.on('close', (code) => {
        if (code === 0) {
          console.log('[SUCCESS] Core dependencies installed');
          resolve();
        } else {
          reject(new Error('Failed to install core dependencies'));
        }
      });
    });
  }

  async stopBackend() {
    if (!this.backendProcess || !this.isRunning) {
      console.log('[SHUTDOWN] Backend already stopped or not running');
      return Promise.resolve();
    }
    
    console.log('[SHUTDOWN] Stopping backend process...');
    console.log(`[DEBUG] Backend PID: ${this.backendProcess.pid}`);
    
    const processToKill = this.backendProcess;
    const processPid = this.backendProcess.pid;
    
    // Step 1: Try HTTP-based graceful shutdown first
    console.log('[SHUTDOWN] Attempting graceful HTTP shutdown...');
    const httpShutdownSuccess = await this.tryHttpShutdown();
    
    if (httpShutdownSuccess) {
      console.log('[SUCCESS] HTTP shutdown completed');
      this.isRunning = false;
      this.backendProcess = null;
      return Promise.resolve();
    }
    
    console.log('[WARNING] HTTP shutdown failed, falling back to process termination...');
    
    // Set flags immediately to prevent double-shutdown
    this.isRunning = false;
    this.backendProcess = null;
    
    return new Promise((resolve) => {
        let terminated = false;
        // Shorter timeout for Windows to avoid hanging
        const timeoutMs = process.platform === 'win32' ? 3000 : 5000;
        
        // Set up close handler to track actual termination
        const onClose = (code, signal) => {
          if (!terminated) {
            terminated = true;
            console.log(`[SUCCESS] Backend terminated - code: ${code}, signal: ${signal}`);
            resolve();
          }
        };
        
        const onError = (error) => {
          console.error('[WARNING] Backend termination error:', error.message);
          if (!terminated) {
            terminated = true;
            resolve(); // Still resolve, as process likely terminated
          }
        };
        
        processToKill.once('close', onClose);
        processToKill.once('error', onError);
        
        try {
          if (process.platform === 'win32') {
            // Windows-specific shutdown approach
            console.log('[SHUTDOWN] Windows process termination...');
            
            // Step 1: Try graceful shutdown first
            const killSuccess = processToKill.kill('SIGTERM');
            console.log(`[DEBUG] SIGTERM sent: ${killSuccess}`);
            
            if (!killSuccess) {
              console.log('[WARNING] SIGTERM failed, process may already be dead');
              if (!terminated) {
                terminated = true;
                resolve();
              }
              return;
            }
            
            // Step 2: Windows-specific timeout and force kill
            const forceKillTimer = setTimeout(() => {
              if (!terminated && !processToKill.killed) {
                console.log('[SHUTDOWN] Windows timeout, using taskkill for force termination...');
                
                try {
                  // Use Windows taskkill command for reliable process termination
                  const { spawn } = require('child_process');
                  
                  // First try killing the process tree by PID
                  console.log(`[SHUTDOWN] Killing process tree for PID ${processPid}...`);
                  const taskkill = spawn('taskkill', ['/PID', processPid.toString(), '/T', '/F'], {
                    stdio: 'pipe',
                    detached: false
                  });
                  
                  let taskkillOutput = '';
                  
                  taskkill.stdout.on('data', (data) => {
                    taskkillOutput += data.toString();
                  });
                  
                  taskkill.stderr.on('data', (data) => {
                    taskkillOutput += data.toString();
                  });
                  
                  taskkill.on('close', (code) => {
                    console.log(`[DEBUG] taskkill PID exited with code: ${code}, output: ${taskkillOutput}`);
                    if (!terminated) {
                      terminated = true;
                      console.log('[SUCCESS] Windows process terminated via taskkill /PID');
                      resolve();
                    }
                  });
                  
                  taskkill.on('error', (error) => {
                    console.error('[WARNING] taskkill PID failed:', error.message);
                    try {
                      process.kill(processPid, 'SIGKILL');
                    } catch (finalError) {
                      console.error('[WARNING] Final kill attempt failed:', finalError.message);
                    }
                    if (!terminated) {
                      terminated = true;
                      resolve();
                    }
                  });
                  
                } catch (taskillError) {
                  console.error('[WARNING] taskkill spawn failed:', taskillError.message);
                  
                  // Final fallback: Node.js process.kill
                  try {
                    process.kill(processPid, 'SIGKILL');
                  } catch (finalError) {
                    console.error('[WARNING] Final kill attempt failed:', finalError.message);
                  }
                  
                  if (!terminated) {
                    terminated = true;
                    resolve();
                  }
                }
              }
            }, timeoutMs);
            
            // Clear timeout if process exits gracefully
            processToKill.once('close', () => {
              clearTimeout(forceKillTimer);
            });
            
          } else {
            // Unix/Linux shutdown approach (existing logic)
            console.log('[SHUTDOWN] Unix process termination...');
            
            // Step 1: Graceful SIGTERM
            const killSuccess = processToKill.kill('SIGTERM');
            console.log(`[DEBUG] SIGTERM sent: ${killSuccess}`);
            
            if (!killSuccess) {
              console.log('[WARNING] SIGTERM failed, process may already be dead');
              if (!terminated) {
                terminated = true;
                resolve();
              }
              return;
            }
            
            // Step 2: Wait for graceful shutdown or timeout
            const forceKillTimer = setTimeout(() => {
              if (!terminated && processToKill.killed === false) {
                console.log('[SHUTDOWN] Graceful shutdown timeout, sending SIGKILL...');
                try {
                  const forceKillSuccess = processToKill.kill('SIGKILL');
                  console.log(`[DEBUG] SIGKILL sent: ${forceKillSuccess}`);
                } catch (killError) {
                  console.error('[WARNING] SIGKILL failed:', killError.message);
                }
                
                // Final timeout to ensure we don't hang forever
                setTimeout(() => {
                  if (!terminated) {
                    terminated = true;
                    console.log('[WARNING] Backend termination timeout reached');
                    resolve();
                  }
                }, 2000);
              }
            }, timeoutMs);
            
            // Clear timeout if process exits gracefully
            processToKill.once('close', () => {
              clearTimeout(forceKillTimer);
            });
          }
          
        } catch (error) {
          console.error('[ERROR] Exception in stopBackend:', error.message);
          if (!terminated) {
            terminated = true;
            resolve();
          }
        }
      });
  }

  async testPython(pythonPath) {
    try {
      const { spawn } = require('child_process');
      return new Promise((resolve) => {
        const test = spawn(pythonPath, ['--version'], { stdio: 'pipe' });
        let output = '';
        
        test.stdout.on('data', (data) => {
          output += data.toString();
        });
        
        test.stderr.on('data', (data) => {
          output += data.toString();
        });
        
        test.on('close', (code) => {
          resolve(`Exit code: ${code}, Output: ${output.trim()}`);
        });
        
        test.on('error', (error) => {
          resolve(`Error: ${error.message}`);
        });
      });
    } catch (error) {
      return `Exception: ${error.message}`;
    }
  }

  getBackendUrl() {
    return `http://127.0.0.1:${this.port}`;
  }

  getLastStartupErrorMessage() {
    if (!this.lastStartupError) {
      return null;
    }
    return this.lastStartupError.message || String(this.lastStartupError);
  }

  getBackendPid() {
    return this.backendPid || (this.backendProcess ? this.backendProcess.pid : null);
  }

  isBackendRunning() {
    return this.isRunning && this.backendProcess && !this.backendProcess.killed;
  }

  // Check if process is still running (Windows-specific check)
  async isProcessStillRunning(pid) {
    if (!pid) return false;
    
    try {
      const { spawn } = require('child_process');
      
      if (process.platform === 'win32') {
        // Windows: Use tasklist to check if process exists
        return new Promise((resolve) => {
          const tasklist = spawn('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV'], {
            stdio: 'pipe'
          });
          
          let output = '';
          tasklist.stdout.on('data', (data) => {
            output += data.toString();
          });
          
          tasklist.on('close', (code) => {
            // If output contains the PID, process is still running
            const stillRunning = output.includes(pid.toString());
            console.log(`[DEBUG] Process ${pid} still running: ${stillRunning}`);
            resolve(stillRunning);
          });
          
          tasklist.on('error', () => resolve(false));
          setTimeout(() => resolve(false), 2000); // Timeout
        });
      } else {
        // Unix: Use kill -0 to check if process exists
        try {
          process.kill(pid, 0);
          return true; // Process exists
        } catch (error) {
          return false; // Process doesn't exist
        }
      }
    } catch (error) {
      console.error(`[WARNING] Process check failed: ${error.message}`);
      return false;
    }
  }

  // Emergency cleanup method for all platforms
  async emergencyCleanup() {
    console.log('[EMERGENCY] Starting emergency cleanup...');
    
    // First check if our tracked process is still running
    if (this.backendPid) {
      const stillRunning = await this.isProcessStillRunning(this.backendPid);
      console.log(`[DEBUG] Tracked process ${this.backendPid} still running: ${stillRunning}`);
    }
    
    try {
      const { spawn } = require('child_process');
      
      if (process.platform === 'win32') {
        // Windows emergency cleanup
        console.log('[EMERGENCY] Windows emergency cleanup...');

        const pidToKill = this.backendPid;
        if (!pidToKill) {
          console.log('[EMERGENCY] No tracked backend PID available, skipping Windows emergency taskkill');
        } else {
          console.log(`[EMERGENCY] Killing tracked backend PID ${pidToKill}...`);
          const killAll = spawn('taskkill', ['/PID', pidToKill.toString(), '/T', '/F'], {
            stdio: 'pipe',
            detached: false
          });

          let killOutput = '';
          killAll.stdout.on('data', (data) => killOutput += data.toString());
          killAll.stderr.on('data', (data) => killOutput += data.toString());

          await new Promise((resolve) => {
            killAll.on('close', (code) => {
              console.log(`[EMERGENCY] taskkill /PID exit code: ${code}, output: ${killOutput}`);
              resolve();
            });
            killAll.on('error', (error) => {
              console.error('[WARNING] Emergency taskkill failed:', error.message);
              resolve();
            });
            setTimeout(resolve, 2000); // Short timeout
          });
        }
        
      } else {
        // Unix emergency cleanup
        console.log('[EMERGENCY] Unix emergency cleanup...');
        
        // Kill all hisaabflow-backend processes
        spawn('pkill', ['-f', 'hisaabflow-backend'], { stdio: 'ignore' });
        spawn('pkill', ['-f', 'uvicorn.*main:app'], { stdio: 'ignore' });
        
        // Give it a moment to take effect
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      console.log('[EMERGENCY] Emergency cleanup completed');
      
    } catch (error) {
      console.error('[ERROR] Emergency cleanup failed:', error.message);
    }
    
    // Clear our tracking variables
    this.isRunning = false;
    this.backendProcess = null;
    this.backendPid = null;
  }
}

module.exports = BackendLauncher;
