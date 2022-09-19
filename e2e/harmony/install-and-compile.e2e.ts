import fs from 'fs';
import chai, { expect } from 'chai';
import path from 'path';
import Helper from '../../src/e2e-helper/e2e-helper';

chai.use(require('chai-fs'));

describe('all custom envs are compiled during installation', function () {
  describe('using pnpm', function () {
    let helper: Helper;
    this.timeout(0);
    before(() => {
      helper = new Helper();
      helper.scopeHelper.setNewLocalAndRemoteScopesHarmony();
      helper.bitJsonc.setupDefault();
      helper.command.create('node-env', 'custom-env1');
      helper.fs.outputFile(
        `${helper.scopes.remoteWithoutOwner}/custom-env1/custom-env1.main.runtime.ts`,
        `
  import { MainRuntime } from '@teambit/cli';
  import { NodeAspect, NodeMain } from '@teambit/node'
  import { EnvsAspect, EnvsMain } from '@teambit/envs';
  import isPositive from 'is-positive'
  import { CustomEnv1Aspect } from './custom-env1.aspect';

  export class CustomEnv1Main {
    static slots = [];

    static dependencies = [NodeAspect, EnvsAspect];

    static runtime = MainRuntime;

    static async provider([node, envs]: [NodeMain, EnvsMain]) {
      console.log(isPositive(1));
      const CustomEnv1Env = node.compose([
        node.overrideDependencies({
          dependencies: {
            'is-negative': '1.0.0'
          },
        })
      ]);
      envs.registerEnv(CustomEnv1Env);
      return new CustomEnv1Main();
    }
  }

  CustomEnv1Aspect.addRuntime(CustomEnv1Main);
  `
      );
      helper.command.create('node-env', 'custom-env2');
      helper.fs.outputFile(
        `${helper.scopes.remoteWithoutOwner}/custom-env2/custom-env2.main.runtime.ts`,
        `
  import { MainRuntime } from '@teambit/cli';
  import { NodeAspect, NodeMain } from '@teambit/node'
  import { EnvsAspect, EnvsMain } from '@teambit/envs';
  import { CustomEnv2Aspect } from './custom-env2.aspect';
  import isNegative from 'is-negative';
  import { MDXAspect, MDXMain } from '@teambit/mdx';
  import { babelConfig } from '@teambit/mdx/dist/babel/babel.config';

  export class CustomEnv2Main {
    static slots = [];

    static dependencies = [NodeAspect, EnvsAspect, MDXAspect];

    static runtime = MainRuntime;

    static async provider([node, envs, mdx]: [NodeMain, EnvsMain, MDXMain]) {
      console.log(isNegative(17));
      const comp = mdx.createCompiler({ ignoredPatterns: [], babelTransformOptions: babelConfig });
      const CustomEnv2Env = node.compose([
        node.overrideCompiler(comp),
        node.overrideDependencies({
          dependencies: {
            'is-odd': '1.0.0',
          },
        })
      ]);
      envs.registerEnv(CustomEnv2Env);
      return new CustomEnv2Main();
    }
  }

  CustomEnv2Aspect.addRuntime(CustomEnv2Main);
  `
      );
      helper.command.setEnv(`custom-env2`, `custom-env1`);
      helper.command.create('node', 'comp');
      helper.fs.outputFile(
        `${helper.scopes.remoteWithoutOwner}/comp/comp.ts`,
        `
  import isOdd from 'is-odd';

  export function comp() {
    console.log(isOdd(17));
  }
  `
      );
      helper.fs.outputFile(`${helper.scopes.remoteWithoutOwner}/comp/comp.mdx`, '');
      helper.command.setEnv(`comp`, `custom-env2`);
      helper.command.install('is-positive'); // installing the dependency of custom-env1
      fs.rmdirSync(path.join(helper.scopes.localPath, 'node_modules'), { recursive: true });
      helper.command.install();
    });
    it('should use the compiled custom env to build the component', () => {
      expect(
        path.join(helper.fixtures.scopes.localPath, 'node_modules', `@${helper.scopes.remote}/comp/dist/comp.mdx.js`)
      ).to.be.a.path();
    });
    it('should install the dependencies dynamically added by the custom envs', () => {
      expect(path.join(helper.fixtures.scopes.localPath, 'node_modules', 'is-negative')).to.be.a.path();
      expect(path.join(helper.fixtures.scopes.localPath, 'node_modules', 'is-odd')).to.be.a.path();
    });
  });
  describe('using yarn', function () {
    let helper: Helper;
    this.timeout(0);
    before(() => {
      helper = new Helper();
      helper.scopeHelper.setNewLocalAndRemoteScopesHarmony();
      helper.bitJsonc.setupDefault();
      helper.extensions.bitJsonc.setPackageManager('teambit.dependencies/yarn');
      helper.command.create('node-env', 'custom-env1');
      helper.fs.outputFile(
        `${helper.scopes.remoteWithoutOwner}/custom-env1/custom-env1.main.runtime.ts`,
        `
  import { MainRuntime } from '@teambit/cli';
  import { NodeAspect, NodeMain } from '@teambit/node'
  import { EnvsAspect, EnvsMain } from '@teambit/envs';
  import isPositive from 'is-positive'
  import { CustomEnv1Aspect } from './custom-env1.aspect';

  export class CustomEnv1Main {
    static slots = [];

    static dependencies = [NodeAspect, EnvsAspect];

    static runtime = MainRuntime;

    static async provider([node, envs]: [NodeMain, EnvsMain]) {
      console.log(isPositive(1));
      const CustomEnv1Env = node.compose([
        node.overrideDependencies({
          dependencies: {
            'is-negative': '1.0.0'
          },
        })
      ]);
      envs.registerEnv(CustomEnv1Env);
      return new CustomEnv1Main();
    }
  }

  CustomEnv1Aspect.addRuntime(CustomEnv1Main);
  `
      );
      helper.command.create('node-env', 'custom-env2');
      helper.fs.outputFile(
        `${helper.scopes.remoteWithoutOwner}/custom-env2/custom-env2.main.runtime.ts`,
        `
  import { MainRuntime } from '@teambit/cli';
  import { NodeAspect, NodeMain } from '@teambit/node'
  import { EnvsAspect, EnvsMain } from '@teambit/envs';
  import { CustomEnv2Aspect } from './custom-env2.aspect';
  import isNegative from 'is-negative';
  import { MDXAspect, MDXMain } from '@teambit/mdx';
  import { babelConfig } from '@teambit/mdx/dist/babel/babel.config';

  export class CustomEnv2Main {
    static slots = [];

    static dependencies = [NodeAspect, EnvsAspect, MDXAspect];

    static runtime = MainRuntime;

    static async provider([node, envs, mdx]: [NodeMain, EnvsMain, MDXMain]) {
      console.log(isNegative(17));
      const comp = mdx.createCompiler({ ignoredPatterns: [], babelTransformOptions: babelConfig });
      const CustomEnv2Env = node.compose([
        node.overrideCompiler(comp),
        node.overrideDependencies({
          dependencies: {
            'is-odd': '1.0.0',
          },
        })
      ]);
      envs.registerEnv(CustomEnv2Env);
      return new CustomEnv2Main();
    }
  }

  CustomEnv2Aspect.addRuntime(CustomEnv2Main);
  `
      );
      helper.command.setEnv(`custom-env2`, `custom-env1`);
      helper.command.create('node', 'comp');
      helper.fs.outputFile(
        `${helper.scopes.remoteWithoutOwner}/comp/comp.ts`,
        `
  import isOdd from 'is-odd';

  export function comp() {
    console.log(isOdd(17));
  }
  `
      );
      helper.fs.outputFile(`${helper.scopes.remoteWithoutOwner}/comp/comp.mdx`, '');
      helper.command.setEnv(`comp`, `custom-env2`);
      helper.command.install('is-positive'); // installing the dependency of custom-env1
      fs.rmdirSync(path.join(helper.scopes.localPath, 'node_modules'), { recursive: true });
      helper.command.install();
    });
    it('should use the compiled custom env to build the component', () => {
      expect(
        path.join(helper.fixtures.scopes.localPath, 'node_modules', `@${helper.scopes.remote}/comp/dist/comp.mdx.js`)
      ).to.be.a.path();
    });
    it('should install the dependencies dynamically added by the custom envs', () => {
      expect(path.join(helper.fixtures.scopes.localPath, 'node_modules', 'is-negative')).to.be.a.path();
      expect(path.join(helper.fixtures.scopes.localPath, 'node_modules', 'is-odd')).to.be.a.path();
    });
  });
});