import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { FormRuntime } from '@/forms-runtime/FormRuntime';
import { makeExampleAnswers } from '@/forms-runtime/example';
import type { RuntimeAnswers } from '@/forms-runtime/types';
import type { FormSchema } from '@/forms-runtime/types';

export function PreviewPane({ schema }: { schema: FormSchema }) {
  const [answers, setAnswers] = useState<RuntimeAnswers>({});
  const [remountKey, setRemountKey] = useState(0);

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-center justify-between gap-2 px-4">
        <span className="text-sm font-semibold">Preview</span>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setAnswers(makeExampleAnswers(schema));
              setRemountKey((k) => k + 1);
            }}
          >
            Fill example
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setAnswers({});
              setRemountKey((k) => k + 1);
            }}
          >
            Reset
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        <FormRuntime
          key={remountKey}
          schema={schema}
          footer={null}
          onSubmit={() => {}}
          initialAnswers={answers}
        />
      </div>
    </div>
  );
}
