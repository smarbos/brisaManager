import { escapeHtml, escapeHtmlVars } from './escape-html';

describe('escapeHtml', () => {
  it('escapes every HTML-significant character', () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    );
  });

  it('leaves plain text untouched', () => {
    expect(escapeHtml('María José Núñez')).toBe('María José Núñez');
  });
});

describe('escapeHtmlVars', () => {
  it('escapes each value, not the keys', () => {
    expect(
      escapeHtmlVars({ guestName: '<b>Ana</b>', url: 'https://x/?a=1&b=2' }),
    ).toEqual({
      guestName: '&lt;b&gt;Ana&lt;/b&gt;',
      url: 'https://x/?a=1&amp;b=2',
    });
  });
});
