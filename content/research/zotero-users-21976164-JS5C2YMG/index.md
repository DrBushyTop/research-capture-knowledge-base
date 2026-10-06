---
id: "zotero-users-21976164-JS5C2YMG"
title: "Scikit-learn: Machine Learning in Python"
source_type: "journalArticle"
source_url: "https://www.jmlr.org/papers/v12/pedregosa11a.html"
doi: null
captured_at: "2026-10-06T12:40:38Z"
published_at: "2011"
authors: ["Fabian Pedregosa","Gaël Varoquaux","Alexandre Gramfort","Vincent Michel","Bertrand Thirion","Olivier Grisel","Mathieu Blondel","Peter Prettenhofer","Ron Weiss","Vincent Dubourg","Jake Vanderplas","Alexandre Passos","David Cournapeau","Matthieu Brucher","Matthieu Perrot","Édouard Duchesnay"]
topics: ["Scientific Python","Machine learning software","Supervised and unsupervised learning","Estimator API design","Cross-validation and hyperparameter selection","Computational benchmarking","Open-source software"]
evidence_status: "text"
processing: {"version":"2","model":"research-sol","processedAt":"2026-10-06T12:45:32.373Z"}
publication: {"status":"private"}
---

# Scikit-learn: Machine Learning in Python

## Source facts

Fabian Pedregosa, Gaël Varoquaux, Alexandre Gramfort, Vincent Michel, Bertrand Thirion, Olivier Grisel, Mathieu Blondel, Peter Prettenhofer, Ron Weiss, Vincent Dubourg, Jake Vanderplas, Alexandre Passos, David Cournapeau, Matthieu Brucher, Matthieu Perrot, Édouard Duchesnay



<https://www.jmlr.org/papers/v12/pedregosa11a.html>

## Machine interpretation

This 2011 JMLR paper describes scikit-learn as a BSD-licensed Python library for medium-scale supervised and unsupervised machine learning\. It presents the library’s consistent estimator interface, model-selection tools, scientific Python integration, and development practices\. Runtime comparisons on the Madelon dataset show competitive performance for several algorithms, but do not establish predictive superiority or performance across datasets\. The description reflects the software at publication, not necessarily current capabilities\.

## Key findings

- The library uses a consistent interface centered on fit, predict, transform, and score methods, with NumPy arrays as data containers\.
- GridSearchCV supports cross-validated parameter selection, while Pipeline combines preprocessing and estimation within the same interface\.
- On Madelon, scikit-learn recorded the lowest reported runtimes among compared implementations for support vector classification \(5\.2 seconds\), Lasso using LARS \(1\.17 seconds\), Elastic Net \(0\.52 seconds\), and PCA with nine components \(0\.18 seconds\)\.
- Scikit-learn was not fastest for every task: k-nearest neighbors took 0\.57 seconds versus 0\.56 seconds for PyMVPA, and k-means took 1\.34 seconds versus 0\.79 seconds for MLPy and 0\.68 seconds for Shogun\.
- The authors report 81% test coverage for release 0\.8 and approximately 300 pages of documentation with more than 60 examples\.

## Limitations

- Runtime comparisons use one dataset with 4,400 instances and 500 attributes, limiting generalization to other workloads\.
- The supplied text does not specify benchmark hardware, complete software versions, detailed parameter settings, repeated measurements, or runtime variability\.
- The benchmark table reports computational time rather than predictive accuracy or equivalent solution quality; differences in implementations may affect comparisons\.
- Some comparator algorithms were unavailable, and PyBrain k-means reportedly did not converge within one hour\.
- The authors acknowledge limitations for very large Elastic Net problems and performance constraints in the then-current pure-Python k-means implementation\.
- Ease of use and accessibility to non-specialists are stated design goals, not outcomes established by a user study\.
- The paper describes the authors’ own software, and its 2011 implementation details should not be assumed to describe current releases\.

## Why this is relevant

- Useful as a foundational citation for scikit-learn and its original software architecture\.
- Provides historical context for consistent machine learning interfaces, pipelines, and cross-validated model selection\.
- Offers an early computational comparison of Python machine learning libraries, with limited applicability to present-day performance\.
- Relevant to research on scientific software engineering and permissively licensed research infrastructure\.

## Evidence status

text


Human commentary belongs in notes.md and survives reprocessing.
