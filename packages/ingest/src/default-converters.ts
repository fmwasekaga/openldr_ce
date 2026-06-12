import { ConverterRegistry } from './converter';
import { fhirBundleConverter } from './converters/fhir-bundle';
import { questionnaireResponseConverter } from './converters/questionnaire-response';

export function defaultConverters(): ConverterRegistry {
  const registry = new ConverterRegistry();
  registry.register(fhirBundleConverter);
  registry.register(questionnaireResponseConverter);
  return registry;
}
