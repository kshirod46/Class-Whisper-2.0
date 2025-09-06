import React, { useState, useCallback, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type } from '@google/genai';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

const API_KEY = process.env.API_KEY;

// --- INTERFACES ---
interface GlossaryItem {
  term: string;
  definition: string;
}

interface StudyMaterials {
  summary: string;
  keySections: string[];
  formulas: string[];
  glossary: GlossaryItem[];
  examQuestions: string[];
  transcript: string;
  detailedNotes: string;
}

interface HistoryItem {
    id: number;
    filename: string;
    materials: StudyMaterials;
}


// --- UI COMPONENTS ---

const Loader = ({ message, progress }: { message: string, progress: number }) => (
  <div className="card loader">
    <div className="spinner"></div>
    <p>Your personal AI tutor is hard at work...</p>
    <p className="loader-message">{message}</p>
    {progress > 0 && (
      <div className="progress-container">
        <div className="progress-bar">
          <div className="progress-bar-fill" style={{ width: `${progress}%` }}></div>
        </div>
        <span className="progress-percentage">{Math.round(progress)}%</span>
      </div>
    )}
  </div>
);

const ErrorDisplay = ({ message, onRetry }: { message: string, onRetry?: () => void }) => (
  <div className="card error-message">
    <p>Oops! Something went wrong.</p>
    <p className="error-details">{message}</p>
    {onRetry && (
        <button onClick={onRetry} className="retry-btn">
            Try Again
        </button>
    )}
  </div>
);

const TranscriptDisplay = ({ transcript }: { transcript: string }) => (
    <pre>{transcript}</pre>
);

const StudyNotes = ({ materials }: { materials: StudyMaterials }) => (
  <div className="study-notes">
    <div>
      <h3>Summary</h3>
      <p>{materials.summary}</p>
    </div>
    <div>
      <h3>Key Sections</h3>
      <ul>
        {materials.keySections.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </div>
    <div>
      <h3>Important Formulas</h3>
      <ul>
        {materials.formulas.map((item, index) => (
          <li key={index}><code>{item}</code></li>
        ))}
      </ul>
    </div>
    <div>
      <h3>Glossary</h3>
      {materials.glossary.map((item, index) => (
         <p key={index} className="glossary-item"><strong>{item.term}:</strong> {item.definition}</p>
      ))}
    </div>
    <div>
      <h3>Potential Exam Questions</h3>
      <ol>
        {materials.examQuestions.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ol>
    </div>
  </div>
);

const DetailedNotesDisplay = ({ notes }: { notes: string }) => {
    // A simple way to format notes. For a richer experience, a markdown parser could be used.
    const formattedNotes = notes.split('\n').map((line, index) => {
        line = line.trim();
        if (line.startsWith('### ')) {
            return <h4 key={index}>{line.substring(4)}</h4>;
        }
        if (line.startsWith('## ')) {
            return <h3 key={index}>{line.substring(3)}</h3>;
        }
        if (line.startsWith('# ')) {
            return <h2 key={index}>{line.substring(2)}</h2>;
        }
        if (line.startsWith('* ') || line.startsWith('- ')) {
            return <li key={index}>{line.substring(2)}</li>;
        }
        if (line === '') {
            return <br key={index} />;
        }
        return <p key={index}>{line}</p>;
    });

    return (
        <div className="detailed-notes-display">
            {formattedNotes}
        </div>
    );
};


// --- MAIN APP COMPONENT ---
const App = () => {
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [audioData, setAudioData] = useState<{ data: string, mimeType: string } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [studyMaterials, setStudyMaterials] = useState<StudyMaterials | null>(null);
  const [error, setError] = useState<{ message: string; retryable: boolean } | null>(null);
  const [activeTab, setActiveTab] = useState<'notes' | 'detailed' | 'transcript'>('notes');
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [downloadingSection, setDownloadingSection] = useState<'notes' | 'detailed' | 'transcript' | null>(null);
  const [isCopied, setIsCopied] = useState(false);

  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Load history from localStorage on initial render
  useEffect(() => {
    try {
        const savedHistory = localStorage.getItem('studyHistory');
        if (savedHistory) {
            setHistory(JSON.parse(savedHistory));
        }
    } catch (err) {
        console.error("Failed to load or parse history from localStorage", err);
        localStorage.removeItem('studyHistory'); // Clear potentially corrupted data
    }
  }, []);

  const handleSaveToHistory = (filename: string, materials: StudyMaterials) => {
    const newItem: HistoryItem = {
        id: Date.now(), // Use timestamp as a unique ID
        filename,
        materials,
    };
    const updatedHistory = [newItem, ...history];
    setHistory(updatedHistory);
    localStorage.setItem('studyHistory', JSON.stringify(updatedHistory));
  };
  
  const handleDeleteFromHistory = (id: number) => {
      const updatedHistory = history.filter(item => item.id !== id);
      setHistory(updatedHistory);
      localStorage.setItem('studyHistory', JSON.stringify(updatedHistory));
  };
  
  const handleViewFromHistory = (item: HistoryItem) => {
      setStudyMaterials(item.materials);
      setMediaFile(new File([], item.filename)); // Create a dummy file for the name
      setActiveTab('notes');
      // Scroll to results
      setTimeout(() => {
          document.querySelector('.results-section')?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
  };


  const processFile = (file: File | undefined) => {
    if (file) {
      setMediaFile(file);
      setStudyMaterials(null);
      setError(null);
      setAudioData(null); // Reset on new file selection

      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        const [header, base64Data] = result.split(',', 2);
        const mimeType = header?.match(/:(.*?);/)?.[1];
        
        if (base64Data && mimeType) {
          setAudioData({ data: base64Data, mimeType });
        } else {
           setError({ message: "Could not read the file. Please try a different audio or video format.", retryable: false });
        }
      };
      reader.onerror = () => {
         setError({ message: "Error reading file. It may be corrupted or in an unsupported format.", retryable: false });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    processFile(event.target.files?.[0]);
  };
  
  const handleDragEnter = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation(); // Necessary to allow drop
  };

  const handleDrop = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    processFile(event.dataTransfer.files?.[0]);
  };

  useEffect(() => {
    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
    };
  }, []);
  
  const startProgressSimulation = () => {
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    progressIntervalRef.current = setInterval(() => {
      setProgress(prev => {
        if (prev >= 99) {
          if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
          return 99;
        }
        const increment = (99 - prev) * 0.05;
        return prev + increment;
      });
    }, 400);
  };

  const handleGenerate = useCallback(async () => {
    if (!API_KEY) {
      setError({ message: "API_KEY environment variable is not set.", retryable: false });
      return;
    }
    if (!audioData || !mediaFile) {
      setError({ message: "Audio data not ready. Please wait a moment after selecting a file or try re-selecting.", retryable: true });
      return;
    }

    setIsProcessing(true);
    setError(null);
    setStudyMaterials(null);
    setProgress(0);
    
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);

    try {
      const ai = new GoogleGenAI({ apiKey: API_KEY });
      const audioPart = {
        inlineData: {
          data: audioData.data,
          mimeType: audioData.mimeType,
        },
      };

      // --- Step 1: Transcription ---
      setLoadingMessage(`Step 1/3: Transcribing audio...`);
      startProgressSimulation();
      
      const transcriptionPrompt = `Transcribe the provided audio lecture precisely into English. Return only the raw text of the English transcript, and nothing else.`;
      
      const transcriptionResult = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: { parts: [audioPart, { text: transcriptionPrompt }] },
      });
      
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
      setProgress(100);
      const transcript = transcriptionResult.text;
      if (!transcript?.trim()) {
        throw new Error("Transcription failed: The model returned an empty transcript. The audio might be silent or in an unsupported format.");
      }
      await new Promise(resolve => setTimeout(resolve, 500));

      // --- Step 2: Study Guide Generation ---
      setLoadingMessage('Step 2/3: Analyzing transcript and generating study guide...');
      setProgress(0);
      startProgressSimulation();
      
      const studyGuideSchema = {
          type: Type.OBJECT,
          properties: {
              summary: { type: Type.STRING },
              keySections: { type: Type.ARRAY, items: { type: Type.STRING } },
              formulas: { type: Type.ARRAY, items: { type: Type.STRING } },
              glossary: {
                  type: Type.ARRAY,
                  items: {
                      type: Type.OBJECT, properties: { term: { type: Type.STRING }, definition: { type: Type.STRING }},
                      propertyOrdering: ["term", "definition"],
                  }
              },
              examQuestions: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          propertyOrdering: ["summary", "keySections", "formulas", "glossary", "examQuestions"],
      };

      const studyGuideResult = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: { parts: [{ text: `Based on the following transcription of a lecture, generate a comprehensive study guide. The output must be a single, valid JSON object.\n\nThe JSON object must contain these fields:\n1. "summary": A concise summary of the entire lecture.\n2. "keySections": A bulleted list of the main topics discussed.\n3. "formulas": A list of all formulas mentioned. If none, return an empty array.\n4. "glossary": A list of key terms and their definitions. Each item should be an object with "term" and "definition" properties. If none, return an empty array.\n5. "examQuestions": A list of 3-5 potential exam questions based on the content.\n\nHere is the transcript:\n---\n${transcript}\n---` }] },
          config: { responseMimeType: "application/json", responseSchema: studyGuideSchema }
      });
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
      setProgress(100);

      let parsedStudyGuide;
      try {
        let jsonText = studyGuideResult.text.trim();
        // Handle markdown code blocks
        if (jsonText.startsWith('```json')) {
            jsonText = jsonText.slice(7, -3).trim();
        } else if (jsonText.startsWith('```')) {
            jsonText = jsonText.slice(3, -3).trim();
        }
        parsedStudyGuide = JSON.parse(jsonText);
      } catch (e) {
        console.error("JSON parsing error:", e);
        console.error("Original text from API:", studyGuideResult.text);
        throw new Error("Failed to process the study guide from the AI. The response was not in the expected JSON format. Please try again.");
      }
      
      await new Promise(resolve => setTimeout(resolve, 500));

      // --- Step 3: Detailed Notes Generation ---
      setLoadingMessage('Step 3/3: Composing detailed lecture notes...');
      setProgress(0);
      startProgressSimulation();

      const detailedNotesPrompt = `Transform the following lecture transcript into a set of high-quality, detailed study notes. The notes should be well-structured, easy to read, and capture the essence of the lecture. Do not just reformat the transcript. Instead, synthesize the information, organize it logically under clear headings, and use bullet points to break down complex topics. Focus on key concepts, definitions, examples, and conclusions. The final output should be formatted in clean markdown.

      Transcript:
      ---
      ${transcript}
      ---`;

      const detailedNotesResult = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: { parts: [{ text: detailedNotesPrompt }] },
      });

      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
      setProgress(100);
      
      const finalMaterials: StudyMaterials = {
        ...parsedStudyGuide,
        transcript: transcript,
        detailedNotes: detailedNotesResult.text,
      };

      setStudyMaterials(finalMaterials);
      handleSaveToHistory(mediaFile.name, finalMaterials);
      setActiveTab('notes');

    } catch (err) {
      console.error(err);
      let isRetryable = true;
      let errorMessage = "An unknown error occurred. Please check the developer console for more details.";
      if (err instanceof Error) {
          if (err.message.includes("xhr error") || err.message.includes("500")) {
              errorMessage = "A network error occurred while communicating with the AI. Please check your internet connection.";
          } else if (err.message.includes("Transcription failed")) {
              errorMessage = err.message;
              isRetryable = false;
          } else {
              errorMessage = err.message;
          }
      }
      setError({ message: errorMessage, retryable: isRetryable });
    } finally {
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
      setIsProcessing(false);
      setLoadingMessage('');
      setProgress(0);
    }
  }, [audioData, mediaFile, history]);
  
  const handleCopyTranscript = async () => {
    if (isCopied || !studyMaterials?.transcript) return;
    try {
        await navigator.clipboard.writeText(studyMaterials.transcript);
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2500); // Reset after 2.5 seconds
    } catch (err) {
        console.error('Failed to copy text: ', err);
    }
  };

  const handleDownload = async (section: 'notes' | 'detailed' | 'transcript') => {
    if (!studyMaterials || !mediaFile || downloadingSection) return;

    setDownloadingSection(section);
    
    const sourceElement = document.getElementById(`${section}-pdf-source`);
    if (!sourceElement) {
        console.error("PDF source element not found!");
        setDownloadingSection(null);
        return;
    }

    const pdfContainer = document.createElement('div');
    pdfContainer.className = 'pdf-render-container';
    
    let title = '';
    switch(section) {
        case 'notes': title = 'Study Notes'; break;
        case 'detailed': title = 'Detailed Notes'; break;
        case 'transcript': title = 'Transcript'; break;
    }
    
    pdfContainer.innerHTML = `
        <div style="padding: 40px;">
            <h1>${title} for ${mediaFile.name}</h1>
            ${sourceElement.innerHTML}
        </div>
    `;
    document.body.appendChild(pdfContainer);

    await new Promise(resolve => setTimeout(resolve, 100));

    try {
        const canvas = await html2canvas(pdfContainer, { useCORS: true, backgroundColor: null });
        const imgWidth = 210; // A4 width in mm
        const pageHeight = 297; // A4 height in mm
        const imgHeight = canvas.height * imgWidth / canvas.width;
        let heightLeft = imgHeight;

        const pdf = new jsPDF('p', 'mm', 'a4');
        let position = 0;

        pdf.addImage(canvas, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;

        while (heightLeft > 0) {
            position -= pageHeight;
            pdf.addPage();
            pdf.addImage(canvas, 'PNG', 0, position, imgWidth, imgHeight);
            heightLeft -= pageHeight;
        }

        const safeFilename = mediaFile.name.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
        pdf.save(`${section}-guide-${safeFilename}.pdf`);

    } catch (err) {
        console.error("Failed to generate PDF", err);
        setError({ message: `Sorry, there was an error creating the PDF for ${title}.`, retryable: false });
    } finally {
        document.body.removeChild(pdfContainer);
        setDownloadingSection(null);
    }
  };


  return (
    <main className="container">
      <header className="card header">
        <div className="brand">
           <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="brand-icon">
             <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"></path>
             <line x1="16" y1="8" x2="2" y2="22"></line>
           </svg>
          <h2>Class Whisper</h2>
        </div>
        <h1>Unlock Your Lecture's Power</h1>
      </header>

      <section className="card upload-section">
        <label 
            htmlFor="file-upload" 
            className={`upload-area ${isDragging ? 'drag-over' : ''}`}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
        >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="upload-icon"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
            <p>Drag & drop your lecture recording</p>
            <span>Supports MP3, WAV, MP4, M4A, and more.</span>
            <button type="button" className="upload-btn" onClick={(e) => { e.preventDefault(); document.getElementById('file-upload')?.click(); }}>
                Or Select File
            </button>
            <input id="file-upload" type="file" accept="audio/*,video/*" onChange={handleFileChange} style={{ display: 'none' }} />
        </label>
        {mediaFile && <p className="file-info">Selected: {mediaFile.name}</p>}

        <button onClick={handleGenerate} disabled={!mediaFile || !audioData || isProcessing} className="shiny-cta generate-shiny-btn">
          <span>{isProcessing ? 'Generating...' : 'Generate Study Guide'}</span>
        </button>
      </section>

      {isProcessing && <Loader message={loadingMessage} progress={progress} />}
      {error && <ErrorDisplay message={error.message} onRetry={error.retryable ? handleGenerate : undefined} />}
      
      {history.length > 0 && (
        <section className="card history-section">
            <h2>Study History</h2>
            <ul className="history-list">
                {history.map(item => (
                    <li key={item.id} className="history-item">
                        <div className="history-item-info">
                            <span className="history-filename" title={item.filename}>{item.filename}</span>
                            <span className="history-date">{new Date(item.id).toLocaleString()}</span>
                        </div>
                        <div className="history-item-actions">
                            <button onClick={() => handleViewFromHistory(item)} className="history-btn view-btn" aria-label={`View study guide for ${item.filename}`}>View</button>
                            <button onClick={() => handleDeleteFromHistory(item.id)} className="history-btn delete-btn" aria-label={`Delete study guide for ${item.filename}`}>Delete</button>
                        </div>
                    </li>
                ))}
            </ul>
        </section>
      )}

      {studyMaterials && (
        <section className="card results-section">
          <div className="results-header">
            <h2>Your Study Guide is Ready!</h2>
          </div>
          <div className="tabs">
            <button className={`tab-btn ${activeTab === 'notes' ? 'active' : ''}`} onClick={() => setActiveTab('notes')}>
              Study Notes
            </button>
            <button className={`tab-btn ${activeTab === 'detailed' ? 'active' : ''}`} onClick={() => setActiveTab('detailed')}>
              Detailed Notes
            </button>
             <button className={`tab-btn ${activeTab === 'transcript' ? 'active' : ''}`} onClick={() => setActiveTab('transcript')}>
              Transcript
            </button>
          </div>
          
          <div className="tab-content">
            {activeTab === 'notes' && (
                <div className="tab-panel">
                    <div className="tab-panel-header">
                        <h3>Study Notes</h3>
                        <button className="section-download-btn" onClick={() => handleDownload('notes')} disabled={!!downloadingSection}>
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                            <span>{downloadingSection === 'notes' ? 'Downloading...' : 'Download PDF'}</span>
                        </button>
                    </div>
                    <div id="notes-pdf-source">
                        <StudyNotes materials={studyMaterials} />
                    </div>
                </div>
            )}
            {activeTab === 'detailed' && (
                <div className="tab-panel">
                    <div className="tab-panel-header">
                         <h3>Detailed Notes</h3>
                        <button className="section-download-btn" onClick={() => handleDownload('detailed')} disabled={!!downloadingSection}>
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                            <span>{downloadingSection === 'detailed' ? 'Downloading...' : 'Download PDF'}</span>
                        </button>
                    </div>
                    <div id="detailed-pdf-source">
                        <DetailedNotesDisplay notes={studyMaterials.detailedNotes} />
                    </div>
                </div>
            )}
            {activeTab === 'transcript' && (
                <div className="tab-panel">
                    <div className="tab-panel-header">
                        <h3>Full Transcript</h3>
                        <div className="header-actions">
                            <button
                                onClick={handleCopyTranscript}
                                className={`copy-btn ${isCopied ? 'copied' : ''}`}
                                disabled={isCopied}
                                aria-label="Copy transcript to clipboard"
                            >
                                {isCopied ? 'Copied!' : 'Copy'}
                            </button>
                            <button className="section-download-btn" onClick={() => handleDownload('transcript')} disabled={!!downloadingSection}>
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                                <span>{downloadingSection === 'transcript' ? 'Downloading...' : 'Download PDF'}</span>
                            </button>
                        </div>
                    </div>
                    <div id="transcript-pdf-source" className="transcript-wrapper">
                        <TranscriptDisplay transcript={studyMaterials.transcript} />
                    </div>
                </div>
            )}
          </div>
        </section>
      )}
    </main>
  );
};

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<App />);