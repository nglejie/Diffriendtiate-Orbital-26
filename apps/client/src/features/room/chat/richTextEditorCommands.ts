import type { Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";

function getLineSegments(parent: any) {
  const segments: Array<{ end: number; start: number }> = [];
  let start = 0;
  parent.content.forEach((node: any, offset: number) => {
    if (node.type?.name === "hardBreak") {
      segments.push({ start, end: offset });
      start = offset + node.nodeSize;
    }
  });
  segments.push({ start, end: parent.content.size });
  return segments;
}

function findCurrentLineIndex(segments: Array<{ end: number; start: number }>, parentOffset: number) {
  for (let index = 0; index < segments.length; index += 1) {
    if (parentOffset >= segments[index].start && parentOffset <= segments[index].end) {
      return index;
    }
  }
  return Math.max(0, segments.length - 1);
}

function splitCurrentParagraphSoftLines(editor: Editor) {
  const { state, view } = editor;
  const { selection, schema } = state;
  if (!selection.empty) return false;

  const { $from } = selection;
  const parent = $from.parent;
  if (parent.type.name !== "paragraph") return false;

  const segments = getLineSegments(parent);
  if (segments.length <= 1) return false;

  const paragraphType = schema.nodes.paragraph;
  if (!paragraphType) return false;

  const currentLineIndex = findCurrentLineIndex(segments, $from.parentOffset);
  const paragraphs = segments.map((segment) =>
    paragraphType.create(parent.attrs, parent.content.cut(segment.start, segment.end)),
  );

  const before = $from.before();
  const after = $from.after();
  let targetParagraphStart = before + 1;
  for (let index = 0; index < currentLineIndex; index += 1) {
    targetParagraphStart += paragraphs[index].nodeSize;
  }

  const currentLineStart = segments[currentLineIndex].start;
  const currentLineSize = paragraphs[currentLineIndex].content.size;
  const cursorOffset = Math.min(Math.max(0, $from.parentOffset - currentLineStart), currentLineSize);
  const tr = state.tr.replaceWith(before, after, paragraphs);
  tr.setSelection(TextSelection.create(tr.doc, targetParagraphStart + cursorOffset));
  view.dispatch(tr);
  return true;
}

export function runCurrentLineBlockCommand(editor: Editor | null | undefined, command: () => boolean | undefined) {
  if (!editor || editor.isDestroyed) return false;
  splitCurrentParagraphSoftLines(editor);
  return command() ?? false;
}
