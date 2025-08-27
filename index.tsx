import React, { useState, useCallback, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type } from '@google/genai';

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
}

// --- UI COMPONENTS ---

const Loader = ({ message }: { message: string }) => (
  <div className="card loader">
    <div className="spinner"></div>
    <p>Your personal AI tutor is warming up...</p>
    <p className="loader-message">{message}</p>
  </div>
);

const ErrorDisplay = ({ message }: { message: string }) => (
  <div className="card error-message">
    <p>Oops! Something went wrong.</p>
    <p>{message}</p>
  </div>
);

const TranscriptDisplay = ({ transcript }: { transcript: string }) => {
    const [isCopied, setIsCopied] = useState(false);

    const handleCopy = async () => {
        if (isCopied) return;
        try {
            await navigator.clipboard.writeText(transcript);
            setIsCopied(true);
            setTimeout(() => setIsCopied(false), 2500); // Reset after 2.5 seconds
        } catch (err) {
            console.error('Failed to copy text: ', err);
        }
    };

    return (
        <div className="transcript-display">
            <div className="transcript-header">
                <h3>Full Transcript</h3>
                <button
                    onClick={handleCopy}
                    className={`copy-btn ${isCopied ? 'copied' : ''}`}
                    disabled={isCopied}
                    aria-label="Copy transcript to clipboard"
                >
                    {isCopied ? 'Copied!' : 'Copy'}
                </button>
            </div>
            <pre>{transcript}</pre>
        </div>
    );
};

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

// --- MAIN APP COMPONENT ---
const App = () => {
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [audioData, setAudioData] = useState<{ data: string, mimeType: string } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [studyMaterials, setStudyMaterials] = useState<StudyMaterials | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'notes' | 'transcript'>('notes');

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
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
           setError("Could not read the file. Please try a different audio or video format.");
        }
      };
      reader.onerror = () => {
         setError("Error reading file. It may be corrupted or in an unsupported format.");
      };
      reader.readAsDataURL(file);
    }
  };
  
  const generateStudyGuide = useCallback(async () => {
    if (!API_KEY) {
      setError("API_KEY environment variable is not set.");
      return;
    }
    if (!audioData) {
      setError("Audio data not ready. Please wait a moment after selecting a file or try re-selecting.");
      return;
    }

    setIsProcessing(true);
    setError(null);
    setStudyMaterials(null);

    try {
      setLoadingMessage('Step 1/3: Uploading and transcribing audio...');
      await new Promise(resolve => setTimeout(resolve, 500)); 

      setLoadingMessage('Step 2/3: Analyzing transcript...');
      const ai = new GoogleGenAI({ apiKey: API_KEY });
      
      const audioPart = {
        inlineData: {
          data: audioData.data,
          mimeType: audioData.mimeType,
        },
      };

      const textPrompt = `First, transcribe the provided audio lecture precisely.
Then, based on that transcription, generate a comprehensive study guide. The output must be a single, valid JSON object.

The JSON object must contain these fields:
1. "transcript": The full, accurate transcription of the audio.
2. "summary": A concise summary of the entire lecture.
3. "keySections": A bulleted list of the main topics discussed.
4. "formulas": A list of all formulas mentioned.
5. "glossary": A list of key terms and their definitions. Each item should be an object with "term" and "definition" properties.
6. "examQuestions": A list of 3-5 potential exam questions based on the content.`;


      setLoadingMessage('Step 3/3: Generating your study guide...');
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: { parts: [audioPart, { text: textPrompt }] },
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    transcript: { type: Type.STRING },
                    summary: { type: Type.STRING },
                    keySections: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING }
                    },
                    formulas: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING }
                    },
                    glossary: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                term: { type: Type.STRING },
                                definition: { type: Type.STRING }
                            },
                             propertyOrdering: ["term", "definition"],
                        }
                    },
                    examQuestions: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING }
                    }
                },
                propertyOrdering: ["transcript", "summary", "keySections", "formulas", "glossary", "examQuestions"],
            }
        }
      });
      
      const parsedResponse = JSON.parse(response.text);
      setStudyMaterials(parsedResponse);
      setActiveTab('notes');

    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "An unknown error occurred. The audio file might be too long or in an unsupported format.");
    } finally {
      setIsProcessing(false);
      setLoadingMessage('');
    }
  }, [audioData]);

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
        <label htmlFor="file-upload" className="upload-area">
          <p>Drag & drop your lecture recording or click to upload.</p>
          <input id="file-upload" type="file" accept="audio/*,video/*" onChange={handleFileChange} style={{ display: 'none' }} />
           <button type="button" className="upload-btn" onClick={() => document.getElementById('file-upload')?.click()}>
            Select File
          </button>
        </label>
        {mediaFile && <p className="file-info">Selected: {mediaFile.name}</p>}
        <button onClick={generateStudyGuide} disabled={!mediaFile || !audioData || isProcessing} className="shiny-cta generate-shiny-btn">
          <span>{isProcessing ? 'Generating...' : 'Generate Study Guide'}</span>
        </button>
      </section>

      {isProcessing && <Loader message={loadingMessage} />}
      {error && <ErrorDisplay message={error} />}
      
      {studyMaterials && (
        <section className="card results-section">
          <h2>Your Study Guide is Ready!</h2>
          <div className="tabs">
            <button className={`tab-btn ${activeTab === 'notes' ? 'active' : ''}`} onClick={() => setActiveTab('notes')}>
              Study Notes
            </button>
             <button className={`tab-btn ${activeTab === 'transcript' ? 'active' : ''}`} onClick={() => setActiveTab('transcript')}>
              Transcript
            </button>
          </div>
          
          <div className="tab-content">
            {activeTab === 'notes' && <StudyNotes materials={studyMaterials} />}
            {activeTab === 'transcript' && <TranscriptDisplay transcript={studyMaterials.transcript} />}
          </div>
        </section>
      )}
    </main>
  );
};

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<App />);