import Document from "./Document";
import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { Box, FormControl } from "@mui/material";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Select, { SelectChangeEvent } from "@mui/material/Select";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import ArticleIcon from "@mui/icons-material/Article";
import ChatIcon from "@mui/icons-material/Chat";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import CloseIcon from "@mui/icons-material/Close";
import SaveIcon from "@mui/icons-material/Save";
import SendIcon from "@mui/icons-material/Send";
import UpdateIcon from "@mui/icons-material/PublishedWithChanges";
import LoadingOverlay from "./LoadingOverlay";
import Logo from "./assets/logo.png";

const BACKEND_URL = "http://127.0.0.1:8000";

type PatentDocument = {
  id: number;
  title: string;
};

type DocumentVersion = {
  id: number;
  document_id: number;
  version: number;
  content: string;
  title: string;
  created_at: string;
  updated_at: string;
};

type AIChatMessage = {
  role: "user" | "assistant";
  content: string;
  context_files?: AIContextFile[];
};

type PersistedAIMessage = AIChatMessage & {
  id: number;
  document_version_id: number;
  created_at: string;
};

type AIContextFile = {
  name: string;
  content: string;
};

function App() {
  const [currentDocumentContent, setCurrentDocumentContent] =
    useState<string>("");
  const [currentDocumentId, setCurrentDocumentId] = useState<number>(0);
  const [currentDocumentTitle, setCurrentDocumentTitle] = useState<string>("");
  const [savedDocumentTitle, setSavedDocumentTitle] = useState<string>("");
  const [currentVersionId, setCurrentVersionId] = useState<number | null>(null);
  const [patentDocuments, setPatentDocuments] = useState<PatentDocument[]>([]);
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isLeftPanelOpen, setIsLeftPanelOpen] = useState<boolean>(true);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState<boolean>(true);
  const [aiMessages, setAiMessages] = useState<AIChatMessage[]>([]);
  const [aiInput, setAiInput] = useState<string>("");
  const [aiContextFiles, setAiContextFiles] = useState<AIContextFile[]>([]);
  const [isAiLoading, setIsAiLoading] = useState<boolean>(false);
  const [, setStatusMessage] = useState<string>("");
  const contextFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    loadPatentDocuments();
  }, []);

  const loadPatentDocuments = async () => {
    setStatusMessage("Loading patents...");
    try {
      const response = await axios.get<PatentDocument[]>(
        `${BACKEND_URL}/documents`
      );
      setPatentDocuments(response.data);
      if (response.data.length > 0) {
        await loadPatent(response.data[0].id);
      }
    } catch (error) {
      console.error("Error loading patents:", error);
      setStatusMessage("Could not load patents");
    }
  };

  // Callback to load a patent from the backend
  const loadPatent = async (documentNumber: number) => {
    setCurrentDocumentId(documentNumber);
    setStatusMessage(`Loading Patent ${documentNumber}...`);
    console.log("Loading patent:", documentNumber);
    try {
      const [documentResponse, versionsResponse] = await Promise.all([
        axios.get<DocumentVersion>(`${BACKEND_URL}/document/${documentNumber}`),
        axios.get<DocumentVersion[]>(
          `${BACKEND_URL}/document/${documentNumber}/versions`
        ),
      ]);

      setCurrentDocumentContent(documentResponse.data.content);
      setCurrentDocumentTitle(documentResponse.data.title);
      setSavedDocumentTitle(documentResponse.data.title);
      setCurrentVersionId(documentResponse.data.id);
      setVersions(versionsResponse.data);
      await loadAiMessages(documentNumber, documentResponse.data.id);
      setStatusMessage(
        `Loaded Patent ${documentNumber}, Version ${documentResponse.data.version}`
      );
    } catch (error) {
      console.error("Error loading document:", error);
      setStatusMessage(`Could not load Patent ${documentNumber}`);
    }
  };

  const addPatent = async () => {
    setIsLoading(true);
    setStatusMessage("Creating patent...");
    try {
      const nextPatentNumber = patentDocuments.length + 1;
      const response = await axios.post<DocumentVersion>(`${BACKEND_URL}/documents`, {
        title: `Patent ${nextPatentNumber}`,
      });
      await loadPatentDocuments();
      await loadPatent(response.data.document_id);
      setStatusMessage(`Created ${response.data.title}`);
    } catch (error) {
      console.error("Error creating patent:", error);
      setStatusMessage("Could not create patent");
    } finally {
      setIsLoading(false);
    }
  };

  const saveTitle = async () => {
    if (!currentDocumentId || !currentVersionId) {
      return;
    }

    const title = currentDocumentTitle.trim() || `Patent ${currentDocumentId}`;
    if (title === savedDocumentTitle) {
      setCurrentDocumentTitle(title);
      return;
    }

    setCurrentDocumentTitle(title);
    await updateCurrentVersion(currentDocumentId, title);
  };

  const loadVersion = async (documentNumber: number, versionId: number) => {
    setStatusMessage("Loading version...");
    try {
      const response = await axios.get<DocumentVersion>(
        `${BACKEND_URL}/document/${documentNumber}/version/${versionId}`
      );

      setCurrentDocumentContent(response.data.content);
      setCurrentDocumentTitle(response.data.title);
      setSavedDocumentTitle(response.data.title);
      setCurrentDocumentId(documentNumber);
      setCurrentVersionId(response.data.id);
      await loadAiMessages(documentNumber, response.data.id);
      setStatusMessage(`Loaded Version ${response.data.version}`);
    } catch (error) {
      console.error("Error loading document version:", error);
      setStatusMessage("Could not load that version");
    }
  };

  const selectVersion = (event: SelectChangeEvent<number>) => {
    loadVersion(currentDocumentId, Number(event.target.value));
  };

  const loadAiMessages = async (documentNumber: number, versionId: number) => {
    try {
      const response = await axios.get<PersistedAIMessage[]>(
        `${BACKEND_URL}/document/${documentNumber}/version/${versionId}/ai/messages`
      );
      setAiMessages(
        response.data.map(({ role, content, context_files }) => ({
          role,
          content,
          context_files,
        }))
      );
    } catch (error) {
      console.error("Error loading AI messages:", error);
      setAiMessages([]);
    }
  };

  const refreshVersions = async (documentNumber: number) => {
    const response = await axios.get<DocumentVersion[]>(
      `${BACKEND_URL}/document/${documentNumber}/versions`
    );
    setVersions(response.data);
  };

  // Callback to persist a patent in the DB
  const savePatent = async (documentNumber: number) => {
    if (!documentNumber) {
      return;
    }

    setIsLoading(true);
    setStatusMessage("Saving new version...");
    try {
      const response = await axios.post<DocumentVersion>(
        `${BACKEND_URL}/save/${documentNumber}`,
        {
          content: currentDocumentContent,
          title: currentDocumentTitle,
        }
      );
      setCurrentDocumentContent(response.data.content);
      setCurrentDocumentTitle(response.data.title);
      setSavedDocumentTitle(response.data.title);
      setCurrentVersionId(response.data.id);
      await refreshVersions(documentNumber);
      setStatusMessage(`Saved Version ${response.data.version}`);
    } catch (error) {
      console.error("Error saving document:", error);
      setStatusMessage("Could not save a new version");
    } finally {
      setIsLoading(false);
    }
  };

  const updateCurrentVersion = async (
    documentNumber: number,
    title = currentDocumentTitle
  ) => {
    if (!documentNumber || !currentVersionId) {
      return;
    }

    setIsLoading(true);
    setStatusMessage("Updating selected version...");
    try {
      const response = await axios.put<DocumentVersion>(
        `${BACKEND_URL}/document/${documentNumber}/version/${currentVersionId}`,
        {
          content: currentDocumentContent,
          title,
        }
      );
      setCurrentDocumentContent(response.data.content);
      setCurrentDocumentTitle(response.data.title);
      setSavedDocumentTitle(response.data.title);
      setCurrentVersionId(response.data.id);
      setVersions((existingVersions) =>
        existingVersions.map((documentVersion) =>
          documentVersion.id === response.data.id ? response.data : documentVersion
        )
      );
      await refreshVersions(documentNumber);
      setStatusMessage(`Updated Version ${response.data.version}`);
    } catch (error) {
      console.error("Error updating document version:", error);
      setStatusMessage("Could not update the selected version");
    } finally {
      setIsLoading(false);
    }
  };

  const sendAiMessage = async () => {
    const instruction = aiInput.trim();
    if (!instruction || isAiLoading) {
      return;
    }
    if (!currentDocumentId || !currentVersionId) {
      setStatusMessage("Load a patent before asking AI to edit");
      return;
    }

    const userMessage: AIChatMessage = {
      role: "user",
      content: instruction,
      context_files: aiContextFiles,
    };
    const nextMessages = [...aiMessages, userMessage];
    const messageContextFiles = aiContextFiles;
    setAiMessages(nextMessages);
    setAiInput("");
    setAiContextFiles([]);
    setIsAiLoading(true);
    setStatusMessage("AI is drafting...");

    try {
      const response = await axios.post<{
        reply: string;
        document: DocumentVersion;
        messages: PersistedAIMessage[];
        did_edit: boolean;
      }>(
        `${BACKEND_URL}/document/${currentDocumentId}/version/${currentVersionId}/ai/write`,
        {
          instruction,
          title: currentDocumentTitle,
          content: currentDocumentContent,
          history: aiMessages.map(({ role, content, context_files }) => ({
            role,
            content,
            context_files: context_files ?? [],
          })),
          context_files: messageContextFiles,
        }
      );

      setCurrentDocumentContent(response.data.document.content);
      setCurrentDocumentTitle(response.data.document.title);
      setSavedDocumentTitle(response.data.document.title);
      setCurrentVersionId(response.data.document.id);
      if (response.data.did_edit) {
        await refreshVersions(currentDocumentId);
        setStatusMessage(`AI edit saved to Version ${response.data.document.version}`);
      } else {
        setStatusMessage("AI response added");
      }

      setAiMessages(
        response.data.messages.map(({ role, content, context_files }) => ({
          role,
          content,
          context_files,
        }))
      );
    } catch (error) {
      console.error("Error generating AI draft:", error);
      let errorMessage = "AI request failed.";
      if (axios.isAxiosError(error)) {
        const detail = error.response?.data?.detail;
        if (typeof detail === "string") {
          errorMessage = detail;
        }
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }
      setAiMessages([
        ...nextMessages,
        {
          role: "assistant",
          content: `I could not generate a draft. ${errorMessage}`,
        },
      ]);
      setStatusMessage(errorMessage);
    } finally {
      setIsAiLoading(false);
    }
  };

  const addContextFiles = async (files: FileList | File[]) => {
    const textFiles = Array.from(files).filter(
      (file) => file.type === "text/plain" || file.name.endsWith(".txt")
    );
    if (textFiles.length === 0) {
      setStatusMessage("Drop .txt files for AI context");
      return;
    }

    try {
      const loadedFiles = await Promise.all(
        textFiles.map(
          (file) =>
            new Promise<AIContextFile>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () =>
                resolve({
                  name: file.name,
                  content: String(reader.result ?? ""),
                });
              reader.onerror = () => reject(reader.error);
              reader.readAsText(file);
            })
        )
      );
      setAiContextFiles((existingFiles) => [...existingFiles, ...loadedFiles]);
      setStatusMessage(`Added ${loadedFiles.length} context file(s)`);
    } catch (error) {
      console.error("Error reading context file:", error);
      setStatusMessage("Could not read that context file");
    }
  };

  const uploadContextFiles = (files: FileList | null) => {
    if (!files) {
      return;
    }

    addContextFiles(files);
  };

  const removeContextFile = (index: number) => {
    setAiContextFiles((existingFiles) =>
      existingFiles.filter((_, fileIndex) => fileIndex !== index)
    );
  };

  const selectedVersion = versions.find(
    (documentVersion) => documentVersion.id === currentVersionId
  );
  const lastUpdatedLabel = selectedVersion
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(selectedVersion.updated_at))
    : "";
  const versionMetadataLabel =
    selectedVersion && lastUpdatedLabel ? `Last updated ${lastUpdatedLabel}` : "";

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
      }}
    >
      {isLoading && <LoadingOverlay />}
      <Box
        component="header"
        sx={{
          alignItems: "center",
          bgcolor: "#000000",
          color: "#ffffff",
          display: "flex",
          height: 80,
          justifyContent: "center",
          mb: "30px",
          position: "relative",
          textAlign: "center",
          width: "100%",
          zIndex: 50,
        }}
      >
        <img src={Logo} alt="Logo" style={{ height: "50px" }} />
      </Box>
      <Box
        sx={{
          bgcolor: "#ffffff",
          display: "flex",
          flex: 1,
          minHeight: 0,
          width: "100%",
        }}
      >
        <Box
          component="aside"
          sx={{
            bgcolor: "#f8fafc",
            borderRight: "1px solid #e5e7eb",
            display: "flex",
            flexDirection: "column",
            flexShrink: 0,
            height: "100%",
            transition: "width 200ms",
            width: isLeftPanelOpen ? 180 : 52,
          }}
        >
          <Box
            sx={{
              alignItems: "center",
              display: "flex",
              height: 48,
              justifyContent: "space-between",
              px: 1,
            }}
          >
            {isLeftPanelOpen && (
              <Box
                sx={{
                  alignItems: "center",
                  color: "#213547",
                  display: "flex",
                  fontSize: "0.875rem",
                  fontWeight: 600,
                  gap: 1,
                  mx: 1,
                }}
              >
                <ArticleIcon fontSize="small" />
                Patents
              </Box>
            )}
            <Tooltip title={isLeftPanelOpen ? "Collapse panel" : "Open panel"}>
              <IconButton
                aria-label={isLeftPanelOpen ? "Collapse panel" : "Open panel"}
                onClick={() => setIsLeftPanelOpen((isOpen) => !isOpen)}
                size="small"
              >
                {isLeftPanelOpen ? <ChevronLeftIcon /> : <ChevronRightIcon />}
              </IconButton>
            </Tooltip>
          </Box>
          {isLeftPanelOpen && (
            <>
              <Box
                component="nav"
                sx={{
                  display: "flex",
                  flex: 1,
                  flexDirection: "column",
                  gap: 1,
                  px: 1.5,
                }}
              >
                {patentDocuments.map((patentDocument) => (
                  <Box
                    component="button"
                    key={patentDocument.id}
                    onClick={() => loadPatent(patentDocument.id)}
                    sx={{
                      border: 0,
                      borderRadius: "5px",
                      color: "#1e1b4b",
                      cursor: "pointer",
                      fontSize: "0.875rem",
                      minWidth: "100%",
                      p: "8px 16px",
                      textAlign: "left",
                      transition: "background-color 0.2s ease, color 0.2s ease",
                      "&:hover": {
                        bgcolor: "#c7d2fe",
                        color: "#1e1b4b",
                      },
                    }}
                    type="button"
                  >
                    {patentDocument.title}
                  </Box>
                ))}
              </Box>
              <Box
                sx={{ display: "flex", justifyContent: "center", p: 1.5 }}
              >
                <Box
                  component="button"
                  disabled={isLoading}
                  onClick={addPatent}
                  sx={{
                    bgcolor: "#ffffff",
                    border: "1px solid #d1d5db",
                    borderRadius: "5px",
                    color: "#213547",
                    cursor: "pointer",
                    fontSize: "0.875rem",
                    fontWeight: 400,
                    p: "8px 12px",
                    textAlign: "center",
                    "&:hover": {
                      bgcolor: "#f1f5f9",
                    },
                  }}
                  type="button"
                >
                  Add new patent
                </Box>
              </Box>
            </>
          )}
        </Box>

        <Box
          component="main"
          sx={{
            display: "flex",
            flex: 1,
            flexDirection: "column",
            minWidth: 0,
            px: 2,
          }}
        >
          <Box
            sx={{
              alignItems: "flex-start",
              display: "flex",
              gap: 1.5,
              minHeight: 56,
              py: 1,
            }}
          >
            <Box
              sx={{
                display: "flex",
                flex: 1,
                flexDirection: "column",
                minWidth: 0,
              }}
            >
              <Box
                aria-label="Document title"
                component="input"
                onBlur={saveTitle}
                onChange={(event) => setCurrentDocumentTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                  }
                }}
                sx={{
                  bgcolor: "transparent",
                  border: 0,
                  borderBottom: "1px solid rgb(33 53 71 / 0.2)",
                  color: "#213547",
                  fontSize: "1.5rem",
                  fontWeight: 600,
                  minWidth: 0,
                  outline: "none",
                  p: 0.5,
                  "&:focus": {
                    borderBottomColor: "#646cff",
                  },
                }}
                value={currentDocumentTitle}
              />
              <Box
                component="span"
                sx={{
                  color: "#64748b",
                  fontSize: "0.875rem",
                  fontWeight: 500,
                  px: 0.5,
                }}
              >
                {versionMetadataLabel}
              </Box>
            </Box>
            <Box
              sx={{
                alignItems: "center",
                display: "flex",
                flexShrink: 0,
                gap: 1,
                ml: "auto",
              }}
            >
              <FormControl size="small" sx={{ minWidth: 132 }}>
                <Select
                  aria-label="Version"
                  displayEmpty
                  onChange={selectVersion}
                  value={currentVersionId ?? ""}
                >
                  {versions.map((documentVersion) => (
                    <MenuItem
                      key={documentVersion.id}
                      value={documentVersion.id}
                    >
                      Version {documentVersion.version}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Tooltip title="Update selected version">
                <span>
                  <IconButton
                    aria-label="Update selected version"
                    disabled={!currentDocumentId || !currentVersionId}
                    onClick={() => updateCurrentVersion(currentDocumentId)}
                    size="small"
                  >
                    <UpdateIcon />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="Save new version">
                <span>
                  <IconButton
                    aria-label="Save new version"
                    disabled={!currentDocumentId}
                    onClick={() => savePatent(currentDocumentId)}
                    size="small"
                  >
                    <SaveIcon />
                  </IconButton>
                </span>
              </Tooltip>
            </Box>
          </Box>
          <Document
            onContentChange={setCurrentDocumentContent}
            content={currentDocumentContent}
          />
        </Box>

        <Box
          component="aside"
          sx={{
            bgcolor: "#f8fafc",
            borderLeft: "1px solid #e5e7eb",
            display: "flex",
            flexDirection: "column",
            flexShrink: 0,
            height: "100%",
            transition: "width 200ms",
            width: isRightPanelOpen ? 340 : 52,
          }}
        >
          <Box
            sx={{
              alignItems: "center",
              display: "flex",
              gap: 1,
              height: 48,
              px: 1,
            }}
          >
            <Tooltip
              title={isRightPanelOpen ? "Collapse AI chat" : "Open AI chat"}
            >
              <IconButton
                aria-label={
                  isRightPanelOpen ? "Collapse AI chat" : "Open AI chat"
                }
                onClick={() => setIsRightPanelOpen((isOpen) => !isOpen)}
                size="small"
              >
                {isRightPanelOpen ? <ChevronRightIcon /> : <ChevronLeftIcon />}
              </IconButton>
            </Tooltip>
            {isRightPanelOpen && (
              <Box
                sx={{
                  alignItems: "center",
                  color: "#213547",
                  display: "flex",
                  fontSize: "0.875rem",
                  fontWeight: 600,
                  gap: 1,
                }}
              >
                <ChatIcon fontSize="small" />
                AI Writer
              </Box>
            )}
          </Box>
          {isRightPanelOpen && (
            <Box
              sx={{
                display: "flex",
                flex: 1,
                flexDirection: "column",
                gap: 1.5,
                minHeight: 0,
                pb: 1.5,
                px: 1.5,
              }}
            >
              <Box
                sx={{
                  display: "flex",
                  flex: 1,
                  flexDirection: "column",
                  gap: 1,
                  minHeight: 0,
                  overflowY: "auto",
                }}
              >
                {aiMessages.map((message, index) => (
                  <Box
                    key={`${message.role}-${index}`}
                    sx={{
                      bgcolor:
                        message.role === "user" ? "#ffffff" : "transparent",
                      borderRadius: "6px",
                      boxShadow:
                        message.role === "user"
                          ? "0 1px 2px 0 rgb(0 0 0 / 0.05)"
                          : "none",
                      color:
                        message.role === "user" ? "#1e1b4b" : "#213547",
                      fontSize: "0.875rem",
                      maxWidth: "85%",
                      ml: message.role === "user" ? "auto" : 0,
                      p: 1.5,
                      textAlign: "left",
                    }}
                  >
                    {message.role === "user" &&
                      (message.context_files?.length ?? 0) > 0 && (
                        <Box
                          sx={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 0.5,
                            alignItems: "flex-end",
                            mb: 0.75,
                          }}
                        >
                          {message.context_files?.map((file, fileIndex) => (
                            <Box
                              key={`${file.name}-${fileIndex}`}
                              sx={{
                                alignItems: "center",
                                display: "flex",
                                gap: 0.5,
                                justifyContent: "flex-end",
                              }}
                            >
                              <AttachFileIcon sx={{ fontSize: 16 }} />
                              <Box
                                component="span"
                                sx={{
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {file.name}
                              </Box>
                            </Box>
                          ))}
                        </Box>
                      )}
                    <Box
                      component="p"
                      sx={{ m: 0, whiteSpace: "pre-wrap" }}
                    >
                      {message.content}
                    </Box>
                  </Box>
                ))}
                {isAiLoading && (
                  <Box
                    sx={{
                      alignItems: "center",
                      bgcolor: "#ffffff",
                      borderRadius: "6px",
                      boxShadow: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
                      color: "#213547",
                      display: "flex",
                      fontSize: "0.875rem",
                      gap: 1,
                      p: 1.5,
                    }}
                  >
                    <CircularProgress size={16} />
                    <Box component="span">Thinking...</Box>
                  </Box>
                )}
              </Box>
              {aiContextFiles.length > 0 && (
                <Box
                  sx={{
                    display: "flex",
                    flexDirection: "column",
                    fontSize: "0.875rem",
                    gap: 0.5,
                  }}
                >
                  {aiContextFiles.map((file, index) => (
                    <Box
                      key={`${file.name}-${index}`}
                      sx={{
                        alignItems: "center",
                        bgcolor: "#f1f5f9",
                        borderRadius: "4px",
                        color: "#475569",
                        display: "flex",
                        justifyContent: "space-between",
                        px: 1,
                        py: 0.5,
                      }}
                    >
                      <Box
                        component="span"
                        sx={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {file.name}
                      </Box>
                      <IconButton
                        aria-label={`Remove ${file.name}`}
                        onClick={() => removeContextFile(index)}
                        size="small"
                      >
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  ))}
                </Box>
              )}
              <Box sx={{ alignItems: "flex-end", display: "flex", gap: 0.5 }}>
                <TextField
                  disabled={isAiLoading}
                  fullWidth
                  maxRows={4}
                  minRows={2}
                  multiline
                  onChange={(event) => setAiInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      sendAiMessage();
                    }
                  }}
                  placeholder="Ask AI to help write..."
                  size="small"
                  value={aiInput}
                />
                <Box sx={{ display: "flex", flexDirection: "column" }}>
                  <input
                    accept=".txt,text/plain"
                    hidden
                    multiple
                    onChange={(event) => {
                      uploadContextFiles(event.target.files);
                      event.target.value = "";
                    }}
                    ref={contextFileInputRef}
                    type="file"
                  />
                  <Tooltip title="Upload context file">
                    <span>
                      <IconButton
                        aria-label="Upload context file"
                        disabled={isAiLoading}
                        onClick={() => contextFileInputRef.current?.click()}
                        size="small"
                      >
                        <AttachFileIcon />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="Send">
                    <span>
                      <IconButton
                        aria-label="Send AI message"
                        disabled={!aiInput.trim() || isAiLoading}
                        onClick={sendAiMessage}
                        size="small"
                      >
                        <SendIcon />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Box>
              </Box>
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}

export default App;
