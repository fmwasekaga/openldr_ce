/** Replace every ${PUBLIC_ORIGIN} occurrence in a realm-import template string. */
export function renderRealm(templateText, publicOrigin) {
  return templateText.split('${PUBLIC_ORIGIN}').join(publicOrigin);
}
