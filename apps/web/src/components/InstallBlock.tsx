import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Copy } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';

// Served from raw GitHub until the landing has a stable domain; then switch to
// https://<domain>/install.sh and /install.ps1.
const BASE = 'https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install';
const COMMANDS: Record<string, string> = {
  unix: `curl -fsSL ${BASE}/install.sh | bash`,
  windows: `irm ${BASE}/install.ps1 | iex`,
  // Inside a WSL2 distro you're on Linux, so it's the same shell installer as unix.
  wsl: `curl -fsSL ${BASE}/install.sh | bash`,
};

function CopyCommandButton({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  const copy = async () => {
    if (!navigator.clipboard?.writeText) return;

    try {
      await navigator.clipboard.writeText(command);
    } catch {
      return;
    }

    setCopied(true);
    clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Button variant="ghost" size="icon" aria-label="Copy command" onClick={copy}>
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
    </Button>
  );
}

function CommandRow({ command }: { command: string }) {
  return (
    <div className="flex items-center gap-3 font-mono text-sm sm:text-base">
      <span className="text-muted-foreground">$</span>
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap">{command}</code>
    </div>
  );
}

export function InstallBlock() {
  const [activeCommand, setActiveCommand] = useState('unix');

  return (
    <section
      id="install"
      aria-label="OpenLDR installation"
      className="mx-auto max-w-5xl px-6 py-20 text-center"
    >
      <div className="mx-auto max-w-2xl">
        <p className="text-base leading-7 text-muted-foreground">
          Requires Docker. The installer brings up the full self-hosted stack locally.
        </p>
      </div>

      <div
        aria-label="OpenLDR install command"
        className="mx-auto mt-8 max-w-4xl overflow-hidden rounded-lg border border-border bg-card text-left shadow-sm"
      >
        <Tabs value={activeCommand} onValueChange={setActiveCommand} className="relative w-full">
          <TabsList className="h-auto w-full max-w-full overflow-x-auto border-b border-border px-4 py-3 pr-16">
            <TabsTrigger
              value="unix"
              className="rounded-md border-b-0 px-3 data-[state=active]:border-b-0 data-[state=active]:bg-background"
            >
              Linux / macOS
            </TabsTrigger>
            <TabsTrigger
              value="windows"
              className="rounded-md border-b-0 px-3 data-[state=active]:border-b-0 data-[state=active]:bg-background"
            >
              Windows
            </TabsTrigger>
            <TabsTrigger
              value="wsl"
              className="rounded-md border-b-0 px-3 data-[state=active]:border-b-0 data-[state=active]:bg-background"
            >
              Windows Server (WSL2)
            </TabsTrigger>
          </TabsList>
          <div className="absolute right-4 top-2.5">
            <CopyCommandButton command={COMMANDS[activeCommand]} />
          </div>

          <TabsContent value="unix" className="px-5 py-6">
            <CommandRow command={COMMANDS.unix} />
            <p className="mt-4 text-sm text-muted-foreground">
              Any Linux distribution or macOS with Docker installed.
            </p>
          </TabsContent>
          <TabsContent value="windows" className="px-5 py-6">
            <CommandRow command={COMMANDS.windows} />
            <p className="mt-4 text-sm text-muted-foreground">
              Windows 10/11 with Docker Desktop - run it in PowerShell.
            </p>
          </TabsContent>
          <TabsContent value="wsl" className="px-5 py-6">
            <CommandRow command={COMMANDS.wsl} />
            <p className="mt-4 text-sm text-muted-foreground">
              Windows Server can&apos;t run these Linux images natively - install Docker CE
              inside a WSL2 Ubuntu distro and run the command above there (it&apos;s Linux).
              New to this?{' '}
              <Link to="/docs/windows-server" className="text-foreground underline underline-offset-4">
                Windows Server (WSL2) setup guide
              </Link>
              .
            </p>
          </TabsContent>
        </Tabs>
      </div>
    </section>
  );
}
