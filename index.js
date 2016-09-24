'use strict';

const ghGot = require('gh-got');

function _delay(timeout) {
    return new Promise(resolve => setTimeout(resolve, timeout));
}

function _poll(fn) {
    return fn().then(result => {
        if (result) return result;
        return _delay(300).then(() => _poll(fn));
    });
}

function BranchDiffersError(message) {
    this.name = 'BranchDiffersError';
    this.message = message || '';
    this.code = 422;
}
BranchDiffersError.prototype = Error.prototype;

module.exports = function(opts = {}) {
    function _fork(owner, repo) {
        return ghGot.post(`repos/${owner}/${repo}/forks`, Object.assing({}, opts, { timeout: 5000 }));
    }

    // checks if repo exists
    function exists(owner, repo) {
        return ghGot.head(`repos/${owner}/${repo}`, opts)
            .then(() => true)
            .catch(err => {
                if (err.statusCode === 404) return false;

                throw err;
            });
    }

    function fork(owner, repo) {
        return exists(owner, repo)
            .then(doesExists => {
                return doesExists ? true : _fork(owner, repo);
            })
            .then(result => {
                if (result === true) return true;

                return _poll(() => exists(owner, repo));
            });
    }

    function getRef(owner, repo, ref) {
        return ghGot(`repos/${owner}/${repo}/git/refs/${ref}`, opts)
            .then(refData => refData.body);
    }

    function createRef(owner, repo, ref, sha) {
        return ghGot.post(`repos/${owner}/${repo}/git/refs`, Object.assign({}, opts, {
            body: { owner, repo, ref: 'refs/' + ref, sha }
        })).then(newRefData => newRefData.body);
    }

    // options.force boolean
    function updateRef(owner, repo, ref, sha, options = {}) {
        return ghGot.patch(`repos/${owner}/${repo}/git/refs/${ref}`, Object.assign({}, opts, {
            body: {
                sha,
                force: options.force || false
            }
        })).then(refData => refData.body)
    }

    function getBranchSha(owner, repo, branch) {
        return getRef(owner, repo, 'heads/' + branch, opts)
            .then(branchRef => branchRef.object.sha);
    }

    // from string branch
    // to string branch
    function branch(owner, repo, from, to) {
        return Promise.all([
            getBranchSha(owner, repo, from),
            getBranchSha(owner, repo, to).catch(toShaErr => false) // target branch does not exist, it's safe to create it
        ]).then(([fromSha, toSha]) => {
            // target branch points to the same ref, do nothing
            if (toSha === fromSha) return {
                object: {
                    sha: toSha
                }
            };
            if (!toSha) return createRef(owner, repo, `heads/${to}`, fromSha);

            throw new BranchDiffersError(`Branch ${to} already exists and differs from ${from}.`);
        });
    }

    function listPulls(owner, repo, base, head) {
        const query = {};
        base && (query.base = base);
        head && (query.head = `${head.owner || owner}:${head.branch || 'master'}`);

        return ghGot(`repos/${owner}/${repo}/pulls`, Object.assign({}, opts, { query }))
            .then(pullsList => pullsList.body);
    }

    function _pull(from, to, msg) {
        return ghGot.post(`repos/${to.owner}/${to.repo || from.repo}/pulls`, Object.assign({}, opts, {
            body: {
                owner: to.owner,
                repo: to.repo || from.repo,
                base: to.branch || 'master',
                head: from.owner + ':' + (from.branch || 'master'),
                title: msg.title,
                issue: msg.issue && msg.issue.toString(),
                body: msg.body || ''
            }
        })).then(pullData => pullData.body);
    }

    // msg.title
    // msg.issue
    // msg.body
    function pull(from, to, msg) {
        const repo = to.repo || from.repo;
        const head = { owner: from.owner || to.owner, branch: from.branch || 'master' };

        return listPulls(to.owner, repo, to.branch || 'master', head)
            .then(pulls => {
                if (pulls.length) return pulls[0]; // already exists
                return _pull(from, to, msg);
            });
    }

    function createBlob(owner, repo, file) {
        const isStr = typeof file.content === 'string';

        return ghGot.post(`repos/${owner}/${repo}/git/blobs`, Object.assign({}, opts, {
            body: {
                owner,
                repo,
                content: isStr ? file.content : file.content.toString('base64'),
                encoding: isStr ? 'utf-8' : 'base64'
            }
        })).then(newBlob => newBlob.body);
    }

    function getCommit(owner, repo, sha) {
        return ghGot(`repos/${owner}/${repo}/git/commits/${sha}`, opts)
            .then(commit => commit.body);
    }

    function getTree(owner, repo, sha) {
        // https://developer.github.com/v3/git/trees/#get-a-tree
        return ghGot(`repos/${owner}/${repo}/git/trees/${sha}`, opts)
            .then(tree => tree.body);
    }

    // tree   array of objects    Required. Objects (of path, mode, type, and sha) specifying a tree structure
    // base_tree    string  The SHA1 of the tree you want to update with new data.
    function createTree(owner, repo, tree, base_tree) {
        return ghGot.post(`repos/${owner}/${repo}/git/trees`, Object.assign({}, opts, {
            body: {
                tree,
                base_tree
            }
        })).then(tree => tree.body);
    }


    // commit.message string Required. The commit message
    // commit.tree  string  Required. The SHA of the tree object this commit points to
    // commit.parents array of strings    Required. The SHAs of the commits that were the parents of this commit. If omitted or empty, the commit will be written as a root commit. For a single parent, an array of one SHA should be provided; for a merge commit, an array of more than one should be provided.
    // commit.name  string  The name of the author (or committer) of the commit
    // commit.email string  The email of the author (or committer) of the commit
    // commit.date  string  Indicates when this commit was authored (or committed). This is a timestamp in ISO 8601 format: YYYY-MM-DDTHH:MM:SSZ
    function _commit(owner, repo, commit) {
        return ghGot.post(`repos/${owner}/${repo}/git/commits`, Object.assign({}, opts, {
            body: commit
        })).then(commitData => commitData.body);
    }

    // commit.branch = 'master'
    // commit.message string
    // commit.updates array of {path: string, content: string|Buffer}
    // options.force = false
    function commit(owner, repo, commit, options = {}) {
        const branch = commit.branch || 'master';

        const updatesPromises = Promise.all(commit.updates.map(file => {
            const path = file.path.replace(/\\/g, '/').replace(/^\//, '');
            const mode = file.mode || '100644';
            const type = file.type || 'blob';

            // TODO: check if file exists
            return createBlob(owner, repo, {
                path, mode, type, content: file.content
            }).then(blob => ({
                path, mode, type, sha: blob.sha, url: blob.url
            }));
        }));

        return getBranchSha(owner, repo, branch).then(latestCommitSha =>
            getCommit(owner, repo, latestCommitSha).then(latestCommit => {
                const baseTreeSha = latestCommit.tree.sha;

                return updatesPromises.then(updates => {
                    return createTree(owner, repo, updates, baseTreeSha)
                        .then(newTree => {
                            const newTreeSha = newTree.sha;

                            return _commit(owner, repo, {
                                owner,
                                repo,
                                message: commit.message,
                                tree: newTreeSha,
                                parents: [latestCommitSha]
                            }).then(commitData => {
                                const newCommitSha = commitData.sha;

                                return updateRef(owner, repo, 'heads/' + branch, newCommitSha, options);
                            });
                        });
                });
            })
        );
    }

    return {
        exists,
        fork,

        getRef,
        createRef,
        updateRef,

        getBranchSha,
        branch,

        listPulls,
        pull,

        createBlob,
        getCommit,
        getTree,
        createTree,
        commit
    };
};
