import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './BibToolbar.module.css'

interface NewEntryTemplate {
  id: string
  label: string
  description: string
  prefix: string
  suffix: string
  placeholder: string
}

const NEW_ENTRY_TEMPLATES: NewEntryTemplate[] = [
  {
    id: 'article',
    label: 'Article',
    description: 'Journal article',
    prefix: '@article{',
    suffix:
      ',\n  author  = {},\n  title   = {},\n  journal = {},\n  year    = {},\n  volume  = {},\n  number  = {},\n  pages   = {},\n}\n',
    placeholder: 'key',
  },
  {
    id: 'book',
    label: 'Book',
    description: 'Book',
    prefix: '@book{',
    suffix:
      ',\n  author    = {},\n  title     = {},\n  publisher = {},\n  year      = {},\n  address   = {},\n}\n',
    placeholder: 'key',
  },
  {
    id: 'inproceedings',
    label: 'Inproceedings',
    description: 'Conference paper',
    prefix: '@inproceedings{',
    suffix:
      ',\n  author    = {},\n  title     = {},\n  booktitle = {},\n  year      = {},\n  pages     = {},\n  publisher = {},\n}\n',
    placeholder: 'key',
  },
  {
    id: 'incollection',
    label: 'Incollection',
    description: 'Chapter in edited book',
    prefix: '@incollection{',
    suffix:
      ',\n  author    = {},\n  title     = {},\n  booktitle = {},\n  editor    = {},\n  publisher = {},\n  year      = {},\n  pages     = {},\n}\n',
    placeholder: 'key',
  },
  {
    id: 'phdthesis',
    label: 'PhD thesis',
    description: 'Doctoral dissertation',
    prefix: '@phdthesis{',
    suffix: ',\n  author = {},\n  title  = {},\n  school = {},\n  year   = {},\n}\n',
    placeholder: 'key',
  },
  {
    id: 'techreport',
    label: 'Tech report',
    description: 'Technical report',
    prefix: '@techreport{',
    suffix:
      ',\n  author      = {},\n  title       = {},\n  institution = {},\n  year        = {},\n  number      = {},\n}\n',
    placeholder: 'key',
  },
  {
    id: 'misc',
    label: 'Misc',
    description: 'Web page, preprint, anything else',
    prefix: '@misc{',
    suffix: ',\n  author       = {},\n  title        = {},\n  year         = {},\n  howpublished = {\\url{}},\n  note         = {},\n}\n',
    placeholder: 'key',
  },
]

interface Props {
  entryCount: number
  canEdit: boolean
  onInsertEntry: (prefix: string, suffix: string, placeholder: string) => void
  onSort: () => void
  onFormat: () => void
  onDeduplicate: () => void
}

export default function BibToolbar({
  entryCount,
  canEdit,
  onInsertEntry,
  onSort,
  onFormat,
  onDeduplicate,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!menuOpen) {
      setMenuPos(null)
      return
    }
    // Anchor the portal-rendered menu to the button's position. Using
    // fixed positioning sidesteps the toolbar's overflow-x clipping.
    const rect = buttonRef.current?.getBoundingClientRect()
    if (rect) setMenuPos({ left: rect.left, top: rect.bottom + 4 })

    function onDocClick(event: MouseEvent) {
      const target = event.target as Node
      if (buttonRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setMenuOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    function onScrollOrResize() {
      setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onScrollOrResize)
    window.addEventListener('scroll', onScrollOrResize, true)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onScrollOrResize)
      window.removeEventListener('scroll', onScrollOrResize, true)
    }
  }, [menuOpen])

  return (
    <div className={styles.bar} role="toolbar" aria-label="Bibliography toolbar">
      <span className={styles.group}>
        <span className={styles.newEntryWrap}>
          <button
            ref={buttonRef}
            className={styles.btn}
            title="Insert a new BibTeX entry"
            onClick={() => setMenuOpen((value) => !value)}
            disabled={!canEdit}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            + New entry ▾
          </button>
          {menuOpen && menuPos
            ? createPortal(
                <div
                  ref={menuRef}
                  className={styles.menu}
                  role="menu"
                  style={{ position: 'fixed', left: menuPos.left, top: menuPos.top }}
                >
                  {NEW_ENTRY_TEMPLATES.map((tpl) => (
                    <button
                      key={tpl.id}
                      className={styles.menuItem}
                      role="menuitem"
                      title={tpl.description}
                      onClick={() => {
                        setMenuOpen(false)
                        onInsertEntry(tpl.prefix, tpl.suffix, tpl.placeholder)
                      }}
                    >
                      <span>{tpl.label}</span>
                      <span className={styles.menuItemHint}>{tpl.id}</span>
                    </button>
                  ))}
                </div>,
                document.body,
              )
            : null}
        </span>
      </span>

      <span className={styles.sep} aria-hidden />

      <span className={styles.group}>
        <button
          className={styles.btn}
          title="Sort entries alphabetically by key"
          onClick={onSort}
          disabled={!canEdit || entryCount < 2}
        >
          Sort
        </button>
        <button
          className={styles.btn}
          title="Normalize whitespace and field alignment"
          onClick={onFormat}
          disabled={!canEdit || entryCount < 1}
        >
          Format
        </button>
        <button
          className={styles.btn}
          title="Remove duplicate keys (keeps first occurrence)"
          onClick={onDeduplicate}
          disabled={!canEdit || entryCount < 2}
        >
          Dedupe
        </button>
      </span>

      <span className={styles.sep} aria-hidden />

      <span
        className={styles.count}
        title={`${entryCount} BibTeX ${entryCount === 1 ? 'entry' : 'entries'} in this file`}
      >
        {entryCount} {entryCount === 1 ? 'entry' : 'entries'}
      </span>
    </div>
  )
}
