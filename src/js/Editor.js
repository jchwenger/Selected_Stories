/*
Editor
*/

import React from 'react';
import Editor from 'draft-js-plugins-editor';
import createSideToolbarPlugin from 'draft-js-side-toolbar-plugin';
import {EditorState, RichUtils, Modifier, CompositeDecorator, SelectionState} from 'draft-js';

import { LSTMGenerator } from './Lstm';

import Loading from './Loading'

import 'draft-js/dist/Draft.css';
import './../css/Menu.css';

const sideToolbarPlugin = createSideToolbarPlugin({

});

const { SideToolbar } = sideToolbarPlugin;
const plugins = [sideToolbarPlugin];

// LSTM Parameters
const length = 128; // The length of the generated result
const seedSize = 128;  // The size of the seed to feed the LSTM

class TextEditor extends React.Component {
  constructor(props) {
    super(props);
    const decorator = new CompositeDecorator([{
        strategy: getEntityStrategy('IMMUTABLE'),
        component: GeneratedSpan,
      }
    ]);
    this.state = {
      placeholder: 'Write something...',
      model: new LSTMGenerator(props.model),
      generated: '',
      timer: setTimeout(()=>{}, 0),
      shouldAutoGenerate: true,
      shouldRegenerate: false,
      isUserWritting: false,
      isLoading: false,
      editorState: EditorState.createEmpty(decorator)
    }
    this.handleKeyCommand = this.handleKeyCommand.bind(this);
    this.handleRightArrow = this.handleRightArrow.bind(this);
    this.handleBeforeInput = this.handleBeforeInput.bind(this);
    this.showGeneratedContent = this.showGeneratedContent.bind(this);
    this.regenerateContent = this.regenerateContent.bind(this);
    this.handleEsc = this.handleEsc.bind(this);
    this.isThereAnEntityHere = this.isThereAnEntityHere.bind(this);
    this.moveCursor = this.moveCursor.bind(this);
    this.handleTab = this.handleTab.bind(this);
    this.onChange = this.onChange.bind(this);
    this.setDomEditorRef = ref => this.domEditor = ref;
  }

  onChange(editorState){
    // Clear the previous timer
    clearTimeout(this.state.timer);

    const currentText = editorState.getCurrentContent().getPlainText();
    let newState;
    // If the lenght has more than 5 chars and we are ready to start generating
    if(currentText.length > 5 && this.state.shouldAutoGenerate){
      newState = {
        editorState,
        isLoading: true,
        timer: setTimeout(()=>{this.showGeneratedContent()}, 2000)
      }
    } 
    // If there's nothing, go back to defaults
    else if (currentText.length === 0){
      newState = {
        editorState,
        shouldAutoGenerate: true,
        shouldRegenerate: false,
        isLoading: false
      };
    } 
    // In any other case, just update the editor
    else {
      newState = {
        editorState
      };
    }
    this.setState(newState);
  }


  componentWillReceiveProps(props){
    this.setState({
      model: new LSTMGenerator(props.model)
    });
    console.log(props)
  }

  // When the component mounts, set focus to it
  componentDidMount(){
    this.domEditor.focus()
  }

  // Handle characters before inputing them in the Editor
  handleBeforeInput(chars, editorState){
    const {contentState, anchorKey, anchorOffset, entityKey} = this.isThereAnEntityHere();
    // If the user is writing on top of a generated text, the Entiy will be removed and
    // the autogenerated property will be back

    this.setState({
      isUserWritting: true,
      shouldAutoGenerate: true,
      shouldRegenerate: false,
    })

  }

  // Handle the LSTM text generation
  generateText(callback){
    this.setState({
      isLoading: true
    });
    const { editorState } = this.state;
    const currentText = editorState.getCurrentContent().getPlainText();
    let seed;
    // Feed at max the defined chars
    if(currentText.length < seedSize){ 
      seed = currentText;
    } else {
      seed = currentText.substring(currentText.length - seedSize ,currentText.length);
    }
    let options = {seed: seed, length: length};

    // Query the model
    this.state.model.generate(options, output => {
      // Just in case we dont get the same length we requested
      let result = output.generated.substring(0, length); 
      callback(result);
    });
  }

  // Show the LSTM Generated content in a new Entity
  showGeneratedContent(){
    this.generateText(resultText => {
      const { editorState } = this.state;
      const contentState = editorState.getCurrentContent();
      const selection = editorState.getSelection();
  
      const anchorKey = selection.getStartKey(); // Get the block id where the caret is
      const anchorOffset = selection.getStartOffset(); // Get the offset position of the caret
      const newEntity = contentState.createEntity('TOKEN' , 'IMMUTABLE');
      const entityKey = contentState.getLastCreatedEntityKey(); // Get the key for this newly created entity
      let generatedSelection = SelectionState.createEmpty(anchorKey).merge({  
        anchorKey: anchorKey,
        anchorOffset: anchorOffset,
        focusOffset: anchorOffset
      }); 
      let newContentState = Modifier.insertText(contentState, generatedSelection, resultText, null, entityKey);
      this.setState({
        editorState: EditorState.push(
          editorState,
          newContentState
        ),
        shouldAutoGenerate: false,
        shouldRegenerate: true,
        generated: resultText,
        isUserWritting: false,
        isLoading: false
      }, ()=> {this.moveCursor(anchorKey,anchorOffset)});
    });
  }

  // Regenerate the content of an already created Entity
  regenerateContent(editorState, contentState, anchorKey, anchorOffset, entityKey){
    this.generateText(resultText => {
      let selectionToReplace = SelectionState.createEmpty(anchorKey).merge({  
        anchorKey,
        anchorOffset: anchorOffset,
        focusOffset: anchorOffset + length
      }); 
      let newContentState = Modifier.replaceText(contentState, selectionToReplace, resultText, null, entityKey);
      this.setState({
        editorState: EditorState.push(
          editorState,
          newContentState
        ),
        shouldAutoGenerate: false,
        shouldRegenerate: true,
        generated: resultText,
        isUserWritting: false,
        isLoading: false
      }, ()=> {this.moveCursor(anchorKey,anchorOffset)});
    });
  }

  // Right Arrow: Regenerate text
  handleRightArrow(event){
    const {editorState, contentState, anchorKey, anchorOffset, entityKey} = this.isThereAnEntityHere();

    // If the next cursor place is an Entity, stop moving and regenerate that entity
    if(entityKey){
      if(this.state.shouldRegenerate){
        event.preventDefault();
        this.setState({
          shouldRegenerate: false
        }, ()=>{
            this.regenerateContent(editorState, contentState, anchorKey, anchorOffset, entityKey);
          })
      } 
    }
  }

  // Tab: Add the generated content to the main text
  handleTab(event) {
    event.preventDefault();
    const {editorState, contentState, anchorKey, anchorOffset, entityKey} = this.isThereAnEntityHere();
    // If the next cursor place is an Entity, remove that entity so the text is added
    if(entityKey){
      let selectionToReplace = SelectionState.createEmpty(anchorKey).merge({  
        anchorKey,
        anchorOffset: anchorOffset,
        focusOffset: anchorOffset + length
      });
      let newContentState = Modifier.applyEntity(contentState, selectionToReplace, null);
      this.setState({
        editorState: EditorState.push(
          editorState,
          newContentState
        ),
        shouldAutoGenerate: true,
        shouldRegenerate: false,
        generated: '',
        isUserWritting: false,
        isLoading: false
      }, ()=> {this.moveCursor(anchorKey,anchorOffset+length)});
    }
  }

  // Delete the current generated prompt
  handleEsc(event){
    event.preventDefault();
    const {editorState, contentState, anchorKey, anchorOffset, entityKey} = this.isThereAnEntityHere();
    if(entityKey){
      let selectionToReplace = SelectionState.createEmpty(anchorKey).merge({  
        anchorKey,
        anchorOffset: anchorOffset,
        focusOffset: anchorOffset + length
      });
      let newContentState = Modifier.replaceText(contentState, selectionToReplace, '');
      this.setState({
        editorState: EditorState.push(
          editorState,
          newContentState
        ),
        shouldAutoGenerate: true,
        shouldRegenerate: false,
        generated: '',
        isUserWritting: false,
        isLoading: false
      }, ()=> {this.moveCursor(anchorKey,anchorOffset)});
    }
  }

  // Move the cursor anywhere
  moveCursor(anchorKey, anchorOffset){
    const { editorState } = this.state;
    let a = EditorState.acceptSelection(editorState, new SelectionState({
      anchorKey,
      anchorOffset,
      focusKey: anchorKey,
      focusOffset: anchorOffset,
    }))
    let b = EditorState.forceSelection(a, a.getSelection())
    this.setState({editorState: b})
  }

  // Check if an entity is at this position
  isThereAnEntityHere(){
    const { editorState } = this.state;
    const contentState = editorState.getCurrentContent();
    const selection = editorState.getSelection();
    const anchorKey = selection.getStartKey(); // Get the block id where the caret is
    const anchorOffset = selection.getStartOffset(); // Get the offset position of the caret
    const currentContentBlock = contentState.getBlockForKey(anchorKey); // Get Current Block
    const entityKey = currentContentBlock.getEntityAt(anchorOffset);
    return {editorState, contentState, anchorKey, anchorOffset, entityKey}
  }

  // Handle Key Commands: Enter, backspace, bolds, italics, etc
  handleKeyCommand(command, editorState) {
    const newState = RichUtils.handleKeyCommand(editorState, command);
     if (newState) {
      this.onChange(newState);
      return 'handled';
    }
    return 'not-handled';
  }
  
  render() {
    return (
      <div>
        <div style={styles.editor} onClick={this.focus}>
          <Editor
          ref={this.setDomEditorRef}
          handleBeforeInput={this.handleBeforeInput}
          editorState={this.state.editorState} 
          onChange={this.onChange} 
          onRightArrow={this.handleRightArrow}
          onEscape={this.handleEsc}
          onTab={this.handleTab}
          handleBeforeInput={this.handleBeforeInput}
          plugins={plugins}
          placeholder={this.state.placeholder}/>
          <SideToolbar />
          <Loading isLoading={this.state.isLoading} isUserWritting={this.state.isUserWritting}/>
        </div>
      </div>
    );
  }
}

function getEntityStrategy(mutability) {
  return function(contentBlock, callback, contentState) {
    contentBlock.findEntityRanges(
      (character) => {
        const entityKey = character.getEntity();
        if (entityKey === null) {
          return false;
        }
        return contentState.getEntity(entityKey).getMutability() === mutability;
      },
      callback
    );
  };
}

const GeneratedSpan = (props) => {
  return (
    <span data-offset-key={props.offsetkey} style={styles.immutable}>
      {props.children}
    </span>
  );
};

const styles = {
  editor: {
    margin: '6% auto',
    width: '50%',
    cursor: 'text',
    fontSize: 16,
    minHeight: 40,
    padding: 10,
    lineHeight: '150%'
  },
  immutable: {
    backgroundColor: 'rgba(88, 222, 179, 0.2)',
    padding: '2px 0',
    color: '#5a5959'
  }
};

export default TextEditor;