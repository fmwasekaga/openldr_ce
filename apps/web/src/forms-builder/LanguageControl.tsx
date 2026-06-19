import { useState } from 'react';
import { Globe, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/cn';

// ─── ISO 639-1 language list ─────────────────────────────────────────────────
// Copied from Corlix's lib/languages.ts; nativeName is the primary display label.

interface LanguageInfo {
  code: string;
  name: string;
  nativeName: string;
}

const ISO_639_1: LanguageInfo[] = [
  { code: 'en', name: 'English',           nativeName: 'English' },
  { code: 'fr', name: 'French',            nativeName: 'Français' },
  { code: 'pt', name: 'Portuguese',        nativeName: 'Português' },
  { code: 'es', name: 'Spanish',           nativeName: 'Español' },
  { code: 'ar', name: 'Arabic',            nativeName: 'العربية' },
  { code: 'sw', name: 'Swahili',           nativeName: 'Kiswahili' },
  { code: 'am', name: 'Amharic',           nativeName: 'አማርኛ' },
  { code: 'ha', name: 'Hausa',             nativeName: 'Hausa' },
  { code: 'yo', name: 'Yoruba',            nativeName: 'Yorùbá' },
  { code: 'ig', name: 'Igbo',              nativeName: 'Asụsụ Igbo' },
  { code: 'zu', name: 'Zulu',              nativeName: 'isiZulu' },
  { code: 'xh', name: 'Xhosa',            nativeName: 'isiXhosa' },
  { code: 'af', name: 'Afrikaans',         nativeName: 'Afrikaans' },
  { code: 'st', name: 'Southern Sotho',    nativeName: 'Sesotho' },
  { code: 'tn', name: 'Tswana',            nativeName: 'Setswana' },
  { code: 'ts', name: 'Tsonga',            nativeName: 'Xitsonga' },
  { code: 'sn', name: 'Shona',             nativeName: 'chiShona' },
  { code: 'rw', name: 'Kinyarwanda',       nativeName: 'Ikinyarwanda' },
  { code: 'rn', name: 'Kirundi',           nativeName: 'Ikirundi' },
  { code: 'ny', name: 'Chichewa',          nativeName: 'Chichewa' },
  { code: 'so', name: 'Somali',            nativeName: 'Soomaali' },
  { code: 'om', name: 'Oromo',             nativeName: 'Afaan Oromoo' },
  { code: 'ti', name: 'Tigrinya',          nativeName: 'ትግርኛ' },
  { code: 'ss', name: 'Swati',             nativeName: 'SiSwati' },
  { code: 've', name: 'Venda',             nativeName: 'Tshivenḓa' },
  { code: 'nr', name: 'Southern Ndebele',  nativeName: 'isiNdebele' },
  { code: 'nd', name: 'Northern Ndebele',  nativeName: 'isiNdebele' },
  { code: 'lg', name: 'Ganda',             nativeName: 'Luganda' },
  { code: 'ln', name: 'Lingala',           nativeName: 'Lingála' },
  { code: 'kg', name: 'Kongo',             nativeName: 'Kikongo' },
  { code: 'wo', name: 'Wolof',             nativeName: 'Wollof' },
  { code: 'ff', name: 'Fula',              nativeName: 'Fulfulde' },
  { code: 'bm', name: 'Bambara',           nativeName: 'Bamanankan' },
  { code: 'ee', name: 'Ewe',               nativeName: 'Eʋegbe' },
  { code: 'ak', name: 'Akan',              nativeName: 'Akan' },
  { code: 'tw', name: 'Twi',               nativeName: 'Twi' },
  { code: 'sg', name: 'Sango',             nativeName: 'Sängö' },
  { code: 'ki', name: 'Kikuyu',            nativeName: 'Gĩkũyũ' },
  { code: 'mg', name: 'Malagasy',          nativeName: 'Malagasy' },
  { code: 'de', name: 'German',            nativeName: 'Deutsch' },
  { code: 'it', name: 'Italian',           nativeName: 'Italiano' },
  { code: 'nl', name: 'Dutch',             nativeName: 'Nederlands' },
  { code: 'ru', name: 'Russian',           nativeName: 'Русский' },
  { code: 'zh', name: 'Chinese',           nativeName: '中文' },
  { code: 'ja', name: 'Japanese',          nativeName: '日本語' },
  { code: 'ko', name: 'Korean',            nativeName: '한국어' },
  { code: 'hi', name: 'Hindi',             nativeName: 'हिन्दी' },
  { code: 'bn', name: 'Bengali',           nativeName: 'বাংলা' },
  { code: 'ur', name: 'Urdu',              nativeName: 'اردو' },
  { code: 'fa', name: 'Persian',           nativeName: 'فارسی' },
  { code: 'tr', name: 'Turkish',           nativeName: 'Türkçe' },
  { code: 'pl', name: 'Polish',            nativeName: 'Polski' },
];

/** Pinned at the top of the picker — common Sub-Saharan + app languages. */
const SUGGESTED_CODES: string[] = ['en', 'fr', 'pt', 'sw', 'am', 'ar', 'ha', 'yo', 'zu'];

const BY_CODE = new Map(ISO_639_1.map((l) => [l.code, l]));

/** "Kiswahili (sw)" for known codes; falls back to the raw code. */
function languageLabel(code: string): string {
  const info = BY_CODE.get(code);
  return info ? `${info.nativeName} (${code})` : code;
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface LanguageControlProps {
  /** ISO-639-1 codes of the extra translation languages (excludes the base language). */
  languages: string[];
  onChange: (langs: string[]) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LanguageControl({ languages, onChange }: LanguageControlProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const add = (code: string) => {
    if (!languages.includes(code)) {
      onChange([...languages, code]);
    }
  };

  const remove = (code: string) => {
    onChange(languages.filter((c) => c !== code));
  };

  const q = search.toLowerCase();

  const suggested = SUGGESTED_CODES.filter(
    (c) => !languages.includes(c) && (q === '' || c.includes(q) || (BY_CODE.get(c)?.name.toLowerCase().includes(q) ?? false) || (BY_CODE.get(c)?.nativeName.toLowerCase().includes(q) ?? false)),
  );

  const rest = ISO_639_1.filter(
    (l) =>
      !languages.includes(l.code) &&
      !SUGGESTED_CODES.includes(l.code) &&
      (q === '' || l.code.includes(q) || l.name.toLowerCase().includes(q) || l.nativeName.toLowerCase().includes(q)),
  );

  return (
    <div className="flex items-center">
      {/* Globe trigger + popover (selected languages are managed inside the popover) */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Languages"
            className={cn(
              'inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-input bg-transparent text-xs text-muted-foreground shadow-sm hover:text-foreground hover:bg-accent transition-colors',
            )}
          >
            <Globe className="h-3.5 w-3.5" aria-hidden />
            {languages.length > 0 && (
              <span className="tabular-nums">{languages.length}</span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 p-2">
          {/* Search */}
          <input
            type="text"
            placeholder="Search languages…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="mb-2 w-full rounded-md border border-input bg-transparent px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
            aria-label="Search languages"
          />

          <div className="max-h-56 overflow-y-auto space-y-0.5">
            {/* Currently selected */}
            {languages.length > 0 && (
              <div>
                <p className="px-1 pb-0.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                  Selected ({languages.length})
                </p>
                {languages.map((code) => (
                  <button
                    key={code}
                    type="button"
                    aria-label={`Remove ${code}`}
                    className="flex w-full items-center gap-2 rounded px-2 py-1 text-xs text-foreground hover:bg-accent transition-colors"
                    onClick={() => remove(code)}
                  >
                    <X className="h-3 w-3 text-muted-foreground" aria-hidden />
                    {languageLabel(code)}
                  </button>
                ))}
              </div>
            )}

            {/* Suggested */}
            {suggested.length > 0 && (
              <div>
                <p className="px-1 pb-0.5 pt-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                  Suggested
                </p>
                {suggested.map((code) => (
                  <button
                    key={code}
                    type="button"
                    aria-label={`Add ${code}`}
                    className="flex w-full items-center gap-2 rounded px-2 py-1 text-xs hover:bg-accent transition-colors"
                    onClick={() => add(code)}
                  >
                    {languageLabel(code)}
                  </button>
                ))}
              </div>
            )}

            {/* All others */}
            {rest.length > 0 && (
              <div>
                <p className="px-1 pb-0.5 pt-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                  All languages
                </p>
                {rest.map((l) => (
                  <button
                    key={l.code}
                    type="button"
                    aria-label={`Add ${l.code}`}
                    className="flex w-full items-center gap-2 rounded px-2 py-1 text-xs hover:bg-accent transition-colors"
                    onClick={() => add(l.code)}
                  >
                    {languageLabel(l.code)}
                  </button>
                ))}
              </div>
            )}

            {suggested.length === 0 && rest.length === 0 && languages.length === 0 && (
              <p className="px-2 py-2 text-xs text-muted-foreground">No languages found.</p>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
