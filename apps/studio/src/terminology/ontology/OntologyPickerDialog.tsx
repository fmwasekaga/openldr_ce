import type { OntologyType } from '../../api';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '../../components/ui/sheet';
import { OntologyBrowser } from './OntologyBrowser';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  codingSystemId: string;
  systemName: string;
  ontologyType?: OntologyType;
  mode?: 'browse' | 'picker';
  onPick: (node: { code: string; display: string }) => void;
  title?: string;
}

export function OntologyPickerDialog({
  open,
  onOpenChange,
  codingSystemId,
  systemName,
  ontologyType,
  mode = 'picker',
  onPick,
  title,
}: Props): JSX.Element {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[920px] overflow-hidden p-0 sm:max-w-[920px]">
        <SheetHeader className="border-b border-border px-3 py-2">
          <SheetTitle className="text-sm">{title ?? `Browse ${systemName}`}</SheetTitle>
          <SheetDescription className="sr-only">Browse ontology terms and select a target concept.</SheetDescription>
        </SheetHeader>
        <div className="h-[calc(100vh-3.25rem)]">
          <OntologyBrowser
            key={codingSystemId}
            codingSystemId={codingSystemId}
            systemName={systemName}
            ontologyType={ontologyType}
            mode={mode}
            onPick={(node) => {
              onPick(node);
              onOpenChange(false);
            }}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
