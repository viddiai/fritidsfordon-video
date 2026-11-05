import React from 'react';
import {CalculateMetadataFunction, Composition} from 'remotion';
import {VehicleVideo, FPS, defaultScenes, totalFrames} from './VehicleVideo';
import type {Vehicle, VideoProps} from './types';
import sample from '../../data/sample-54103.json';

const vehicle = sample as unknown as Vehicle;
const base: VideoProps = {vehicle, format: 'vertical', scenes: defaultScenes(vehicle), sold: false, assetBase: ''};

const calc: CalculateMetadataFunction<VideoProps> = ({props}) => ({
  durationInFrames: totalFrames(props.scenes?.length ? props.scenes : defaultScenes(props.vehicle)),
});

export const Root: React.FC = () => (
  <>
    <Composition id="Vertical" component={VehicleVideo} fps={FPS} width={1080} height={1920}
      durationInFrames={totalFrames(base.scenes)} defaultProps={{...base, format: 'vertical'}} calculateMetadata={calc} />
    <Composition id="Landscape" component={VehicleVideo} fps={FPS} width={1920} height={1080}
      durationInFrames={totalFrames(base.scenes)} defaultProps={{...base, format: 'landscape'}} calculateMetadata={calc} />
  </>
);
