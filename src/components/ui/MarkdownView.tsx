import React, { useMemo } from 'react';
import { marked } from 'marked';

interface MarkdownViewProps {
  content: string;
  className?: string;
}

// Cleans any leftover safety status classifier text and dollar sign math delimiters from AI output
export function sanitizeSafetyOutput(rawText: string): string {
  if (!rawText) return '';
  let cleaned = rawText
    .replace(/^User Safety:\s*(safe|unsafe)[\r\n]*/gim, '')
    .replace(/^Response Safety:\s*(safe|unsafe)[\r\n]*/gim, '')
    .replace(/User Safety:\s*(safe|unsafe)/gi, '')
    .replace(/Response Safety:\s*(safe|unsafe)/gi, '')
    .replace(/\[Safety Verification:[^\]]*\]/gi, '');

  // Strip LaTeX math delimiters ($$...$$ and $...$) so equations display cleanly as plain math
  cleaned = cleaned
    .replace(/\$\$(.+?)\$\$/gs, '$1')
    .replace(/\$([^$\n\r]+?)\$/g, '$1');

  return cleaned;
}

export const MarkdownView: React.FC<MarkdownViewProps> = ({ content, className = '' }) => {
  const html = useMemo(() => {
    const cleaned = sanitizeSafetyOutput(content || '');
    try {
      return marked.parse(cleaned, {
        breaks: true,
        gfm: true,
      }) as string;
    } catch {
      return cleaned;
    }
  }, [content]);

  return (
    <div
      className={`prose prose-invert max-w-none w-full break-words overflow-x-auto leading-relaxed text-sm sm:text-[14.5px] ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};
