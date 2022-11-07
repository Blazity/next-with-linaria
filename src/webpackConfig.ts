import type { NextConfig } from 'next';
import type * as NextServer from 'next/dist/server/config-shared';
import path from 'path';
import type * as Webpack from 'webpack';

import {
  LinariaLoaderOptions,
  regexLinariaCSS,
  regexLinariaGlobalCSS,
} from './transformLoader';
import { isCssLoader, isCssModule } from './utils';
import VirtualModuleStore from './VirtualModuleStore';

// Thanks https://github.com/Mistereo/next-linaria/blob/de4fd15269bd059e35797bb7250ce84cc8c5067c/index.js#L3
// for the inspiration
function traverseLoaders(rules: Webpack.RuleSetRule[]) {
  for (const rule of rules) {
    if (isCssLoader(rule)) {
      if (isCssModule(rule)) {
        const nextGetLocalIdent = rule.options.modules.getLocalIdent;
        const nextMode = rule.options.modules.mode;

        // allow global css for *.linaria.global.css files
        rule.options.modules.mode = (path) => {
          const isGlobal = regexLinariaGlobalCSS.test(path);
          if (isGlobal) {
            return 'local';
          }
          return typeof nextMode === 'function' ? nextMode(path) : nextMode;
        };

        // We don't want the default css-loader to generate classnames
        // for linaria modules, since those are generated by linaria.
        rule.options.modules.getLocalIdent = (
          context,
          _,
          exportName,
          ...rest
        ) => {
          if (regexLinariaCSS.test(context.resourcePath)) {
            return exportName;
          }
          return nextGetLocalIdent(context, _, exportName, ...rest);
        };
      }
    }
    if (typeof rule.use === 'object') {
      // FIXME: Can we do it without the typecast?
      const useRules = rule.use as Webpack.RuleSetRule | Webpack.RuleSetRule[];
      traverseLoaders(Array.isArray(useRules) ? useRules : [useRules]);
    }
    if (Array.isArray(rule.oneOf)) {
      traverseLoaders(rule.oneOf);
    }
  }
}

let moduleStore: VirtualModuleStore;

export type LinariaConfig = NextConfig & {
  linaria?: Omit<LinariaLoaderOptions, 'moduleStore'>;
};

export default function withLinaria({
  linaria = {},
  ...nextConfig
}: LinariaConfig) {
  const webpack = (
    config: Webpack.Configuration,
    options: NextServer.WebpackConfigContext,
  ) => {
    if (config.module?.rules && config.plugins) {
      traverseLoaders(config.module.rules as Webpack.RuleSetRule[]);

      // Add our store for virtual linaria css modules
      if (!moduleStore) {
        moduleStore = new VirtualModuleStore(config);
      }
      config.plugins.push(moduleStore.createStore(config.name));

      // Add css output loader with access to the module store
      // in order to set the correct dependencies
      config.module.rules.push({
        test: regexLinariaCSS,
        exclude: /node_modules/,
        use: [
          {
            loader: path.resolve(__dirname, './outputCssLoader'),
            options: {
              moduleStore,
            },
          },
        ],
      });

      // Add linaria loader to transform files
      const linariaLoaderOptions: LinariaLoaderOptions = {
        sourceMap: process.env.NODE_ENV !== 'production',
        displayName: process.env.NODE_ENV !== 'production',
        babelOptions: {
          presets: ['next/babel', '@linaria'],
        },
        ...linaria,
        moduleStore,
      };
      config.module.rules.push({
        test: /\.(tsx|ts|js|mjs|jsx)$/,
        exclude: /node_modules/,
        use: [
          {
            loader: path.resolve(__dirname, './transformLoader'),
            options: linariaLoaderOptions,
          },
        ],
      });
    }

    if (typeof nextConfig.webpack === 'function') {
      return nextConfig.webpack(config, options);
    }
    return config;
  };

  return {
    ...nextConfig,
    webpack,
  };
}

module.exports = withLinaria;