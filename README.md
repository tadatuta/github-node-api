# github-node-api

High level [github API](https://developer.github.com/v3/) wrapper on top of [gh-got](https://github.com/sindresorhus/gh-got).

## Installation

```
npm i github-node-api --save
```

## Usage

```js
const gna = require('github-node-api')({ token: 'YOUR-GITHUB-TOKEN-HERE' });
```
You may also pass a token via `GITHUB_TOKEN` environment variable.
To get a token follow [the instructions](https://developer.github.com/v3/oauth/).

For list of all available options see `got` [documentation](https://github.com/sindresorhus/got#options).

If you use [GitHub Enterprise](https://enterprise.github.com/), set up API endpoint with `GITHUB_ENDPOINT` environment variable.

### API

#### Repositories
* exists
* fork

#### Git data
##### Blobs
* createBlob

##### Commits
* getCommit
* commit

##### Trees
* getTree
* createTree

##### References
* getRef
* createRef
* updateRef

* getBranchSha
* branch

#### Pull Requests
* listPulls
* pull
