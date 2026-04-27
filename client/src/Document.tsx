import Editor from "./Editor";
import Box from "@mui/material/Box";

export interface DocumentProps {
  onContentChange: (content: string) => void;
  content: string;
}

export default function Document({ onContentChange, content }: DocumentProps) {
  return (
    <Box sx={{ height: "100%", overflowY: "auto", width: "100%" }}>
      <Editor handleEditorChange={onContentChange} content={content} />
    </Box>
  );
}
