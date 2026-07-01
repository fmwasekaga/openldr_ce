import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';

// Served from raw GitHub until the landing has a stable domain; then switch to
// https://<domain>/install.sh and /install.ps1.
const BASE = 'https://raw.githubusercontent.com/fmwasekaga/openldr_ce/main/install';
const COMMANDS: Record<string, string> = {
  unix: `curl -fsSL ${BASE}/install.sh | bash`,
  windows: `irm ${BASE}/install.ps1 | iex`,
};

function CommandRow({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout>>();
  // Clear a pending "copied" reset if the row unmounts (avoids a state update
  // after unmount).
  useEffect(() => () => clearTimeout(resetTimer.current), []);
  const copy = async () => {
    // navigator.clipboard is undefined in non-secure contexts (plain http://,
    // some webviews). Fail silently rather than throwing an unhandled rejection.
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
    <div className="flex items-center gap-2 rounded-md border border-border bg-card px-4 py-3 font-mono text-sm">
      <code className="flex-1 overflow-x-auto whitespace-nowrap">{command}</code>
      <Button variant="ghost" size="icon" aria-label="Copy command" onClick={copy}>
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  );
}

export function InstallBlock() {
  return (
    <section id="install" className="mx-auto max-w-3xl px-6 py-16 text-center">
      <h2 className="mb-2 text-2xl font-semibold">Install in one line</h2>
      <p className="mb-6 text-muted-foreground">Requires Docker. Brings up the full stack locally.</p>
      <Tabs defaultValue="unix" className="w-full">
        <TabsList>
          <TabsTrigger value="unix">Linux / macOS</TabsTrigger>
          <TabsTrigger value="windows">Windows</TabsTrigger>
        </TabsList>
        <TabsContent value="unix"><CommandRow command={COMMANDS.unix} /></TabsContent>
        <TabsContent value="windows"><CommandRow command={COMMANDS.windows} /></TabsContent>
      </Tabs>
    </section>
  );
}
