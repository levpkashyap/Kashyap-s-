/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { 
  Search, 
  ShieldCheck, 
  AlertCircle, 
  CheckCircle2, 
  XCircle, 
  ExternalLink, 
  Loader2, 
  History,
  Info,
  ArrowRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface FactCheckResult {
  verdict: 'True' | 'False' | 'Misleading' | 'Unverified';
  summary: string;
  evidence: string;
  sources: { title: string; url: string }[];
  biasAnalysis?: string;
  relatedQuestions?: string[];
}

interface ExtractedClaim {
  text: string;
  context?: string;
  category?: string;
}

export default function App() {
  const [mode, setMode] = useState<'verify' | 'extract'>('verify');
  const [claim, setClaim] = useState('');
  const [inputText, setInputText] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [result, setResult] = useState<FactCheckResult | null>(null);
  const [extractedClaims, setExtractedClaims] = useState<ExtractedClaim[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<{claim: string, verdict: string}[]>([]);

  const aiRef = useRef<GoogleGenAI | null>(null);

  const getAI = () => {
    if (!aiRef.current) {
      aiRef.current = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
    }
    return aiRef.current;
  };

  const handleVerify = async (e?: React.FormEvent, claimToVerify?: string) => {
    if (e) e.preventDefault();
    const targetClaim = claimToVerify || claim;
    if (!targetClaim.trim()) return;

    setMode('verify');
    setClaim(targetClaim);
    setIsAnalyzing(true);
    setError(null);
    setResult(null);

    try {
      const ai = getAI();
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Fact check the following claim: "${targetClaim}". 
        Provide a structured response in Markdown with:
        1. **Verdict**: One word (True, False, Misleading, or Unverified).
        2. **Summary**: A concise explanation of why.
        3. **Detailed Evidence**: Key facts pulled from sources.
        4. **Sources**: List the URLs used for verification.
        5. **Bias Analysis**: A brief (2-3 sentence) analysis of any potential bias or emotional language in the claim itself.
        6. **Related Questions**: A JSON-formatted list of 3 follow-up questions to explore this topic further.`,
        config: {
          tools: [{ googleSearch: {} }],
        },
      });

      const text = response.text || '';
      
      const verdictMatch = text.match(/\*\*Verdict\*\*:\s*(True|False|Misleading|Unverified)/i);
      const verdict = (verdictMatch ? verdictMatch[1] : 'Unverified') as FactCheckResult['verdict'];
      
      const biasMatch = text.match(/\*\*Bias Analysis\*\*:\s*([\s\S]*?)(?=\n\d\.|\n\*\*|$)/i);
      const biasAnalysis = biasMatch ? biasMatch[1].trim() : undefined;

      const questionsMatch = text.match(/\*\*Related Questions\*\*:\s*([\s\S]*?)$/i);
      let relatedQuestions: string[] = [];
      if (questionsMatch) {
        try {
          const jsonStr = questionsMatch[1].trim().replace(/```json|```/g, '');
          relatedQuestions = JSON.parse(jsonStr);
        } catch (e) {
          // Fallback parsing if JSON fails
          relatedQuestions = questionsMatch[1].split('\n').filter(q => q.trim()).map(q => q.replace(/^\d\.\s*|- \s*/, '').trim()).slice(0, 3);
        }
      }
      
      const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
      const sources = groundingChunks
        .filter(chunk => chunk.web)
        .map(chunk => ({
          title: chunk.web?.title || 'Source',
          url: chunk.web?.uri || ''
        }))
        .filter(s => s.url);

      setResult({
        verdict,
        summary: text.split('**Bias Analysis**')[0].trim(), // Keep the main summary clean
        evidence: '',
        sources: sources.length > 0 ? sources : [],
        biasAnalysis,
        relatedQuestions: relatedQuestions.length > 0 ? relatedQuestions : undefined
      });

      setHistory(prev => [{ claim: targetClaim, verdict }, ...prev].slice(0, 5));
    } catch (err) {
      console.error(err);
      setError('Failed to verify claim. Please try again.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleExtract = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    setIsExtracting(true);
    setError(null);
    setExtractedClaims([]);

    try {
      const ai = getAI();
      const isUrl = inputText.trim().startsWith('http');
      
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: isUrl 
          ? `Extract the top 5 most significant factual claims from this URL: ${inputText}. Return them as a JSON array of objects with "text" and "category" fields.`
          : `Extract the top 5 most significant factual claims from the following text: "${inputText}". Return them as a JSON array of objects with "text" and "category" fields.`,
        config: {
          tools: isUrl ? [{ urlContext: {} }] : [],
          responseMimeType: "application/json",
        },
      });

      const claims = JSON.parse(response.text || '[]');
      setExtractedClaims(Array.isArray(claims) ? claims : []);
    } catch (err) {
      console.error(err);
      setError('Failed to extract claims. Please ensure the text or URL is valid.');
    } finally {
      setIsExtracting(false);
    }
  };

  const getVerdictStyles = (verdict: string) => {
    switch (verdict.toLowerCase()) {
      case 'true': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      case 'false': return 'bg-rose-100 text-rose-700 border-rose-200';
      case 'misleading': return 'bg-amber-100 text-amber-700 border-amber-200';
      default: return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  const getVerdictIcon = (verdict: string) => {
    switch (verdict.toLowerCase()) {
      case 'true': return <CheckCircle2 className="w-5 h-5" />;
      case 'false': return <XCircle className="w-5 h-5" />;
      case 'misleading': return <AlertCircle className="w-5 h-5" />;
      default: return <Info className="w-5 h-5" />;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => {
            setMode('verify');
            setResult(null);
            setClaim('');
          }}>
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <ShieldCheck className="text-white w-5 h-5" />
            </div>
            <h1 className="font-bold text-xl tracking-tight text-slate-900">VeriFact AI</h1>
          </div>
          <nav className="hidden sm:flex items-center gap-6 text-sm font-medium text-slate-600">
            <button 
              onClick={() => setMode('verify')}
              className={cn("transition-colors", mode === 'verify' ? "text-indigo-600" : "hover:text-indigo-600")}
            >
              Verify Claim
            </button>
            <button 
              onClick={() => setMode('extract')}
              className={cn("transition-colors", mode === 'extract' ? "text-indigo-600" : "hover:text-indigo-600")}
            >
              Extract Claims
            </button>
          </nav>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-8 sm:py-12">
        {/* Hero Section */}
        <div className="text-center mb-12">
          <motion.h2 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4"
          >
            {mode === 'verify' ? 'Verify any claim in seconds.' : 'Extract claims from text or web.'}
          </motion.h2>
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-slate-600 max-w-2xl mx-auto"
          >
            {mode === 'verify' 
              ? 'Our AI cross-references information with authentic web sources and open-source databases to provide you with a reliable verdict.'
              : 'Paste a URL or a block of text, and we\'ll automatically identify factual claims that need verification.'}
          </motion.p>
        </div>

        {/* Mode Selector (Mobile) */}
        <div className="flex sm:hidden justify-center gap-4 mb-8">
          <button 
            onClick={() => setMode('verify')}
            className={cn("px-4 py-2 rounded-full text-sm font-medium", mode === 'verify' ? "bg-indigo-600 text-white" : "bg-white text-slate-600 border border-slate-200")}
          >
            Verify
          </button>
          <button 
            onClick={() => setMode('extract')}
            className={cn("px-4 py-2 rounded-full text-sm font-medium", mode === 'extract' ? "bg-indigo-600 text-white" : "bg-white text-slate-600 border border-slate-200")}
          >
            Extract
          </button>
        </div>

        {/* Search / Input Area */}
        <div className="max-w-3xl mx-auto mb-12">
          {mode === 'verify' ? (
            <form onSubmit={handleVerify} className="relative group">
              <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
                <Search className="w-5 h-5 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
              </div>
              <input
                type="text"
                value={claim}
                onChange={(e) => setClaim(e.target.value)}
                placeholder="Enter a claim to verify (e.g., 'The Great Wall of China is visible from space')"
                className="w-full pl-12 pr-32 py-4 bg-white border border-slate-200 rounded-2xl shadow-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all text-slate-900"
              />
              <button
                type="submit"
                disabled={isAnalyzing || !claim.trim()}
                className="absolute right-2 top-2 bottom-2 px-6 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-all flex items-center gap-2"
              >
                {isAnalyzing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="hidden sm:inline">Analyzing</span>
                  </>
                ) : (
                  <>
                    <span>Verify</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
          ) : (
            <form onSubmit={handleExtract} className="space-y-4">
              <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm focus-within:ring-2 focus-within:ring-indigo-500/20 focus-within:border-indigo-500 transition-all">
                <textarea
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="Paste a URL (e.g., https://example.com/news) or a block of text here..."
                  className="w-full h-32 bg-transparent outline-none resize-none text-slate-900 placeholder:text-slate-400"
                />
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={isExtracting || !inputText.trim()}
                  className="px-8 py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-all flex items-center gap-2"
                >
                  {isExtracting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Extracting Claims...</span>
                    </>
                  ) : (
                    <>
                      <span>Identify Claims</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
          {error && (
            <p className="mt-3 text-sm text-rose-600 flex items-center gap-1">
              <AlertCircle className="w-4 h-4" />
              {error}
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Results Area */}
          <div className="lg:col-span-2 space-y-6">
            <AnimatePresence mode="wait">
              {mode === 'verify' ? (
                isAnalyzing ? (
                  <motion.div
                    key="loading-verify"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="bg-white border border-slate-200 rounded-2xl p-12 flex flex-col items-center justify-center text-center"
                  >
                    <div className="relative mb-6">
                      <div className="w-16 h-16 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin" />
                      <ShieldCheck className="absolute inset-0 m-auto w-6 h-6 text-indigo-600" />
                    </div>
                    <h3 className="text-lg font-semibold text-slate-900 mb-2">Cross-referencing sources...</h3>
                    <p className="text-slate-500 text-sm max-w-xs">
                      We're searching the web and analyzing data from authentic databases to verify your claim.
                    </p>
                  </motion.div>
                ) : result ? (
                  <motion.div
                    key="result-verify"
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="space-y-6"
                  >
                    {/* Verdict Card */}
                    <div className={cn(
                      "border rounded-2xl p-6 flex items-start gap-4",
                      getVerdictStyles(result.verdict)
                    )}>
                      <div className="mt-1">{getVerdictIcon(result.verdict)}</div>
                      <div>
                        <h3 className="text-lg font-bold mb-1">Verdict: {result.verdict}</h3>
                        <p className="text-sm opacity-90">
                          Based on our analysis of current web data and authentic sources.
                        </p>
                      </div>
                    </div>

                    {/* Detailed Analysis */}
                    <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8">
                      <h3 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-2">
                        <Info className="w-5 h-5 text-indigo-600" />
                        Analysis Summary
                      </h3>
                      <div className="markdown-body prose prose-slate max-w-none">
                        <ReactMarkdown>{result.summary}</ReactMarkdown>
                      </div>
                    </div>

                    {/* AI Insights: Bias Analysis */}
                    {result.biasAnalysis && (
                      <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-6">
                        <h3 className="text-sm font-bold text-indigo-900 uppercase tracking-wider mb-3 flex items-center gap-2">
                          <AlertCircle className="w-4 h-4" />
                          AI Bias Analysis
                        </h3>
                        <p className="text-sm text-indigo-800 leading-relaxed italic">
                          "{result.biasAnalysis}"
                        </p>
                      </div>
                    )}

                    {/* AI Insights: Related Questions */}
                    {result.relatedQuestions && (
                      <div className="bg-white border border-slate-200 rounded-2xl p-6">
                        <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4">
                          Explore Further
                        </h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {result.relatedQuestions.map((q, idx) => (
                            <button
                              key={idx}
                              onClick={() => handleVerify(undefined, q)}
                              className="text-left p-3 rounded-xl border border-slate-100 hover:border-indigo-300 hover:bg-indigo-50 transition-all text-xs font-medium text-slate-600 hover:text-indigo-700"
                            >
                              {q}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Sources Card */}
                    {result.sources.length > 0 && (
                      <div className="bg-white border border-slate-200 rounded-2xl p-6">
                        <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4">
                          Authentic Sources Used
                        </h3>
                        <div className="space-y-3">
                          {result.sources.map((source, idx) => (
                            <a
                              key={idx}
                              href={source.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center justify-between p-3 rounded-xl border border-slate-100 hover:border-indigo-200 hover:bg-indigo-50 transition-all group"
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-400 group-hover:bg-indigo-100 group-hover:text-indigo-600 transition-colors">
                                  {idx + 1}
                                </div>
                                <span className="text-sm font-medium text-slate-700 truncate">
                                  {source.title}
                                </span>
                              </div>
                              <ExternalLink className="w-4 h-4 text-slate-400 group-hover:text-indigo-600" />
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </motion.div>
                ) : (
                  <motion.div
                    key="empty-verify"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="bg-white border border-dashed border-slate-300 rounded-2xl p-12 flex flex-col items-center justify-center text-center"
                  >
                    <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                      <ShieldCheck className="w-8 h-8 text-slate-300" />
                    </div>
                    <h3 className="text-lg font-medium text-slate-900 mb-2">Ready to verify</h3>
                    <p className="text-slate-500 text-sm max-w-xs">
                      Enter a claim above to start the fact-checking process.
                    </p>
                  </motion.div>
                )
              ) : (
                isExtracting ? (
                  <motion.div
                    key="loading-extract"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="bg-white border border-slate-200 rounded-2xl p-12 flex flex-col items-center justify-center text-center"
                  >
                    <div className="relative mb-6">
                      <div className="w-16 h-16 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin" />
                      <Search className="absolute inset-0 m-auto w-6 h-6 text-indigo-600" />
                    </div>
                    <h3 className="text-lg font-semibold text-slate-900 mb-2">Scanning content...</h3>
                    <p className="text-slate-500 text-sm max-w-xs">
                      Our AI is identifying factual statements that can be verified.
                    </p>
                  </motion.div>
                ) : extractedClaims.length > 0 ? (
                  <motion.div
                    key="result-extract"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-4"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-lg font-bold text-slate-900">Extracted Claims</h3>
                      <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded-md">
                        {extractedClaims.length} Found
                      </span>
                    </div>
                    {extractedClaims.map((item, idx) => (
                      <div 
                        key={idx}
                        className="bg-white border border-slate-200 rounded-2xl p-5 hover:border-indigo-300 hover:shadow-md transition-all group"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">
                                {item.category || 'General'}
                              </span>
                            </div>
                            <p className="text-slate-800 font-medium leading-relaxed">
                              {item.text}
                            </p>
                          </div>
                          <button
                            onClick={() => handleVerify(undefined, item.text)}
                            className="shrink-0 px-4 py-2 bg-slate-900 text-white text-xs font-bold rounded-lg hover:bg-indigo-600 transition-colors flex items-center gap-2"
                          >
                            Verify
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </motion.div>
                ) : (
                  <motion.div
                    key="empty-extract"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="bg-white border border-dashed border-slate-300 rounded-2xl p-12 flex flex-col items-center justify-center text-center"
                  >
                    <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                      <Search className="w-8 h-8 text-slate-300" />
                    </div>
                    <h3 className="text-lg font-medium text-slate-900 mb-2">No claims extracted yet</h3>
                    <p className="text-slate-500 text-sm max-w-xs">
                      Paste text or a URL above to identify claims for verification.
                    </p>
                  </motion.div>
                )
              )}
            </AnimatePresence>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* History Card */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6">
              <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                <History className="w-4 h-4" />
                Recent Checks
              </h3>
              {history.length > 0 ? (
                <div className="space-y-4">
                  {history.map((item, idx) => (
                    <div key={idx} className="group cursor-pointer" onClick={() => handleVerify(undefined, item.claim)}>
                      <p className="text-sm text-slate-700 font-medium line-clamp-2 mb-1 group-hover:text-indigo-600 transition-colors">
                        {item.claim}
                      </p>
                      <span className={cn(
                        "text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border",
                        getVerdictStyles(item.verdict)
                      )}>
                        {item.verdict}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-400 italic">No recent activity</p>
              )}
            </div>

            {/* Info Card */}
            <div className="bg-indigo-600 rounded-2xl p-6 text-white">
              <h3 className="font-bold mb-2 flex items-center gap-2">
                <ShieldCheck className="w-5 h-5" />
                Why Trust Us?
              </h3>
              <p className="text-sm text-indigo-100 leading-relaxed mb-4">
                VeriFact AI uses Google Search grounding to ensure every claim is checked against live, reputable web data.
              </p>
              <ul className="text-xs space-y-2 text-indigo-100">
                <li className="flex items-center gap-2">
                  <div className="w-1 h-1 bg-white rounded-full" />
                  Real-time web analysis
                </li>
                <li className="flex items-center gap-2">
                  <div className="w-1 h-1 bg-white rounded-full" />
                  Citations for every check
                </li>
                <li className="flex items-center gap-2">
                  <div className="w-1 h-1 bg-white rounded-full" />
                  Neutral, data-driven verdicts
                </li>
              </ul>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-8 mt-auto">
        <div className="max-w-5xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-slate-500">
            © 2026 VeriFact AI. Powered by Google Gemini.
          </p>
          <div className="flex items-center gap-6 text-sm text-slate-400">
            <a href="#" className="hover:text-slate-600 transition-colors">Privacy Policy</a>
            <a href="#" className="hover:text-slate-600 transition-colors">Terms of Service</a>
            <a href="#" className="hover:text-slate-600 transition-colors">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
