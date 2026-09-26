/**
 * Public free tools (Part 01 §1.11). Slugs are URL segments under /{locale}/tools
 * and keys of `publicTools.tools` in the message dictionaries.
 */
export const TOOL_SLUGS = [
  'clean-core-lookup',
  'cloud-successor',
  'api-deprecations',
  'xml-field-checker',
  'fiori-403',
  'search',
] as const;
export type ToolSlug = (typeof TOOL_SLUGS)[number];

export function isToolSlug(value: string): value is ToolSlug {
  return (TOOL_SLUGS as readonly string[]).includes(value);
}
